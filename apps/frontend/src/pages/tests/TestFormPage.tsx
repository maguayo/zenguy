import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone, TriangleAlert } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { listChannels } from "../../api/channels";
import { createTest, getTest, updateTest, validateDraft } from "../../api/tests";
import type { BrowserTestInput, IrreversibleActionScope } from "../../api/types";
import { ChannelPicker, defaultChannelIds } from "../../components/ChannelPicker";
import { RecoveryToggle } from "../../components/RecoveryToggle";
import { RunStatusPanel } from "../../components/RunStatusPanel";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { RemoteAiConsentBanner } from "../../components/RemoteAiConsentBanner";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { Textarea } from "../../components/ui/Textarea";
import { Toggle } from "../../components/ui/Toggle";
import { fieldError } from "../../components/ui/form";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { apiErrorMessage, itemQueryErrorMessage } from "../../lib/errors";
import { runCostCopy } from "./hooks";

export const stagingCredentialsCopy =
  "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.";
export const timeoutHelpCopy =
  "Each attempt can run for up to 5 minutes. If it takes longer, it ends with a Timeout status and may be retried according to your settings.";
export const tokenNoteCopy =
  "Tests are designed for a nominal maximum of 200,000 tokens. If a test is very large, split it into smaller tests.";
export const irreversibleApprovalCopy =
  "I attest that every credential and record used by these actions is staging/test-only. Each run still requires a separate human confirmation.";

const actionScopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("DOM"),
    action: z.literal("CLICK"),
    origin: z.string().url().startsWith("https://"),
    path: z.string().startsWith("/"),
    target: z.object({
      attribute: z.enum(["data-testid", "id", "name", "aria-label"]),
      value: z.string().min(1).max(120),
      tag: z.enum(["BUTTON", "INPUT"]),
      type: z.literal("submit"),
      form: z.object({
        method: z.literal("POST"),
        origin: z.string().url().startsWith("https://"),
        path: z.string().startsWith("/"),
      }),
    }),
    maxUses: z.number().int().min(1).max(3),
  }),
  z.object({
    kind: z.literal("HTTP"),
    method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
    origin: z.string().url().startsWith("https://"),
    path: z.string().startsWith("/"),
    maxUses: z.number().int().min(1).max(3),
  }),
]);

const actionScopesSchema = z
  .array(actionScopeSchema)
  .max(20)
  .superRefine((scopes, context) => {
    const locators = new Set<string>();
    scopes.forEach((scope, index) => {
      if (scope.kind !== "DOM") return;
      const linked = scopes.some(
        (candidate) =>
          candidate.kind === "HTTP" &&
          candidate.method === scope.target.form.method &&
          candidate.origin === scope.target.form.origin &&
          candidate.path === scope.target.form.path &&
          candidate.maxUses >= scope.maxUses,
      );
      const locator = JSON.stringify({
        origin: scope.origin,
        path: scope.path,
        attribute: scope.target.attribute,
        value: scope.target.value,
      });
      if (!linked || locators.has(locator)) {
        context.addIssue({
          code: "custom",
          path: [index, "target"],
          message:
            "DOM targets must be unique and link to an equal-or-larger HTTP POST scope.",
        });
      }
      locators.add(locator);
    });
  });

export function parseActionScopesJson(value: string): IrreversibleActionScope[] {
  const parsed: unknown = JSON.parse(value);
  return actionScopesSchema.parse(parsed);
}

export const testFormSchema = z.object({
  allowedDomains: z
    .array(z.string())
    .max(20, "Use at most 20 additional domains.")
    .superRefine((domains, context) => {
      const domainPattern = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
      if (domains.some((domain) => !domainPattern.test(domain))) {
        context.addIssue({
          code: "custom",
          message: "Use lowercase hostnames such as checkout.example.com or *.example.com.",
        });
      }
    }),
  writableDomains: z
    .array(z.string())
    .max(20, "Use at most 20 writable domains.")
    .superRefine((domains, context) => {
      const exactDomainPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/u;
      if (domains.some((domain) => !exactDomainPattern.test(domain))) {
        context.addIssue({
          code: "custom",
          message: "Use exact lowercase hostnames; writable wildcards are not allowed.",
        });
      }
    }),
  testDataAttested: z.boolean(),
  irreversibleActionScopesJson: z.string().superRefine((value, context) => {
    try {
      parseActionScopesJson(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "Enter a valid JSON array of at most 20 exact action scopes.",
      });
    }
  }),
  channelIds: z.array(z.string()),
  device: z.enum(["DESKTOP", "MOBILE"]),
  instructions: z.string().trim().min(1, "Instructions are required."),
  intervalHours: z.number().int().min(1).max(24),
  maxRetries: z.number().int().min(0).max(3),
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must be 120 characters or fewer."),
  notifyOnRecovery: z.boolean(),
  startUrl: z
    .string()
    .url("Enter a valid URL.")
    .refine((value) => /^https?:\/\//iu.test(value), "URL must start with http:// or https://."),
}).superRefine((config, context) => {
  let startHost: string | null = null;
  try {
    startHost = new URL(config.startUrl).hostname.toLowerCase();
  } catch {
    // startUrl owns its validation message.
  }
  config.writableDomains.forEach((writable, index) => {
    const allowed =
      writable === startHost ||
      config.allowedDomains.some((domain) =>
        domain.startsWith("*.")
          ? writable.endsWith(`.${domain.slice(2)}`)
          : writable === domain,
      );
    if (!allowed) {
      context.addIssue({
        code: "custom",
        path: ["writableDomains", index],
        message: "Writable host must also be the starting or an allowed domain.",
      });
    }
  });
  let scopes: IrreversibleActionScope[] = [];
  try {
    scopes = parseActionScopesJson(config.irreversibleActionScopesJson);
  } catch {
    return;
  }
  if (scopes.length > 0 && !config.testDataAttested) {
    context.addIssue({
      code: "custom",
      path: ["testDataAttested"],
      message: "Staging/test data attestation is required for action scopes.",
    });
  }
});

type TestFormValues = z.infer<typeof testFormSchema>;

export const intervalOptions = Array.from({ length: 24 }, (_, index) => index + 1);

export function retryOptionLabel(retries: number): string {
  if (retries === 0) return "0 retries — no retries";
  const delays = ["immediately", "after 1 min", "after 2 min"].slice(0, retries);
  return `${retries} ${retries === 1 ? "retry" : "retries"} — ${delays.join(", ")}`;
}

const defaults: TestFormValues = {
  allowedDomains: [],
  writableDomains: [],
  testDataAttested: false,
  irreversibleActionScopesJson: "[]",
  channelIds: [],
  device: "DESKTOP",
  instructions: "",
  intervalHours: 24,
  maxRetries: 1,
  name: "",
  notifyOnRecovery: true,
  startUrl: "",
};

export default function TestFormPage() {
  const { testId } = useParams();
  const editing = Boolean(testId);
  const { can, current } = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const handleMutationError = useMutationError();
  const [validationRunId, setValidationRunId] = useState<string | null>(null);
  const [validationRunning, setValidationRunning] = useState(false);
  const test = useQuery({
    enabled: editing,
    queryFn: () => getTest(current.id, testId ?? ""),
    queryKey: ["ws", current.id, "tests", testId],
  });
  const channels = useQuery({
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const form = useForm<TestFormValues>({
    defaultValues: defaults,
    mode: "onChange",
    resolver: zodResolver(testFormSchema),
  });

  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (editing || appliedDefaults.current || !channels.data) return;
    appliedDefaults.current = true;
    if (form.getValues("channelIds").length === 0) {
      form.setValue("channelIds", defaultChannelIds(channels.data));
    }
  }, [channels.data, editing, form]);

  useEffect(() => {
    if (!test.data) return;
    form.reset({
      allowedDomains: test.data.allowedDomains ?? [],
      writableDomains: test.data.writableDomains ?? [],
      testDataAttested: test.data.testDataAttested ?? false,
      irreversibleActionScopesJson: JSON.stringify(
        test.data.irreversibleActionScopes ?? [],
        null,
        2,
      ),
      channelIds: test.data.channelIds,
      device: test.data.device,
      instructions: test.data.instructions,
      intervalHours: test.data.intervalHours,
      maxRetries: test.data.maxRetries,
      name: test.data.name,
      notifyOnRecovery: test.data.notifyOnRecovery,
      startUrl: test.data.startUrl,
    });
  }, [form, test.data]);

  const validation = useMutation({
    mutationFn: (input: {
      values: BrowserTestInput;
      approveIrreversibleActions: boolean;
    }) =>
      validateDraft(
        current.id,
        input.values,
        input.approveIrreversibleActions,
      ),
  });

  const browserTestInput = (values: TestFormValues): BrowserTestInput => {
    const { irreversibleActionScopesJson, ...config } = values;
    return {
      ...config,
      irreversibleActionScopes: parseActionScopesJson(
        irreversibleActionScopesJson,
      ),
    };
  };

  const runValidation = async () => {
    const valid = await form.trigger();
    if (!valid || validationRunning) return;
    const values = browserTestInput(form.getValues());
    const approveIrreversibleActions = values.irreversibleActionScopes.length > 0;
    if (
      approveIrreversibleActions &&
      !window.confirm(
        `Authorize ${values.irreversibleActionScopes.length} exact irreversible action scope(s) for this run? ${irreversibleApprovalCopy}`,
      )
    ) {
      return;
    }
    try {
      setValidationRunId(null);
      const result = await validation.mutateAsync({
        values,
        approveIrreversibleActions,
      });
      setValidationRunId(result.runId);
      setValidationRunning(true);
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const input = browserTestInput(values);
      const saved = editing
        ? await updateTest(current.id, testId ?? "", input)
        : await createTest(current.id, input);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success(editing ? "Changes saved" : "Test created — first run scheduled");
      navigate(`/w/${current.id}/tests/${saved.id}`);
    } catch (error) {
      if (handleMutationError(error)) return;
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          const field = detail.field.startsWith("irreversibleActionScopes")
            ? "irreversibleActionScopesJson"
            : detail.field;
          if (field in defaults) {
            form.setError(field as keyof TestFormValues, { message: detail.message });
            handled = true;
          }
        }
        if (handled) return;
      }
      form.setError("root", { message: apiErrorMessage(error) });
    }
  });

  if (!can("tests.manage")) return <Navigate replace to={`/w/${current.id}/tests`} />;
  if (editing && test.isPending) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Spinner label="Loading browser test" size={6} />
      </div>
    );
  }
  if (editing && test.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(test.error)}
        onRetry={() => void test.refetch()}
      />
    );
  }

  const selectedDevice = form.watch("device");

  return (
    <form className="space-y-6" noValidate onSubmit={(event) => void submit(event)}>
      <PageHeader
        description={editing ? "Update the flow, schedule, and notifications." : "Describe a flow for Zenguy to verify in a real browser."}
        title={editing ? "Edit browser test" : "New browser test"}
      />

      <RemoteAiConsentBanner />

      <Card title="Basics">
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            error={fieldError(form.formState, "name")}
            htmlFor="test-name"
            label="Name"
            required
          >
            <Input
              id="test-name"
              invalid={Boolean(form.formState.errors.name)}
              {...form.register("name")}
            />
          </Field>
          <Field
            error={fieldError(form.formState, "startUrl")}
            htmlFor="test-start-url"
            label="Starting URL"
            required
          >
            <Input
              autoComplete="url"
              id="test-start-url"
              invalid={Boolean(form.formState.errors.startUrl)}
              placeholder="https://staging.example.com"
              type="url"
              {...form.register("startUrl")}
            />
          </Field>
        </div>
      </Card>

      <Card title="Instructions">
        <Field
          error={fieldError(form.formState, "instructions")}
          hint="Write what to do and what must be true, in plain language. Reference secrets like {{SHOP_PASSWORD}}."
          htmlFor="test-instructions"
          label="Steps and expected result"
          required
        >
          <Textarea
            id="test-instructions"
            invalid={Boolean(form.formState.errors.instructions)}
            rows={8}
            {...form.register("instructions")}
          />
        </Field>
        <div className="mt-4 flex gap-2 rounded-md border border-warn-600/20 bg-warn-50 p-3 text-sm text-zinc-700">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn-600" />
          <p>{stagingCredentialsCopy}</p>
        </div>
        <p className="mt-3 text-xs text-zinc-500">{tokenNoteCopy}</p>
      </Card>

      <Card title="Browser permissions">
        <Field
          error={fieldError(form.formState, "allowedDomains")}
          hint="The starting hostname is always included. Add comma-separated external hostnames needed for checkout, OAuth, APIs, or assets. Wildcards such as *.example.com are supported."
          htmlFor="test-allowed-domains"
          label="Additional allowed domains"
        >
          <Controller
            control={form.control}
            name="allowedDomains"
            render={({ field }) => (
              <Input
                id="test-allowed-domains"
                invalid={Boolean(form.formState.errors.allowedDomains)}
                placeholder="checkout.example.com, *.login.example.com"
                value={field.value.join(", ")}
                onBlur={() => {
                  field.onChange(field.value.filter(Boolean));
                  field.onBlur();
                }}
                onChange={(event) =>
                  field.onChange(
                    event.target.value
                      .split(",")
                      .map((domain) => domain.trim())
                  )
                }
              />
            )}
          />
        </Field>
        <Field
          error={fieldError(form.formState, "writableDomains")}
          hint="Exact staging/test hosts only. This authorizes local input, select, checkbox, and radio interactions. Submit buttons, Enter/Space activation, and mutating HTTP requests remain blocked until per-run human approval and exact action scope exist."
          htmlFor="test-writable-domains"
          label="Writable staging/test domains"
        >
          <Controller
            control={form.control}
            name="writableDomains"
            render={({ field }) => (
              <Input
                id="test-writable-domains"
                invalid={Boolean(form.formState.errors.writableDomains)}
                placeholder="staging.example.com, login-staging.example.net"
                value={field.value.join(", ")}
                onBlur={() => {
                  field.onChange(field.value.filter(Boolean));
                  field.onBlur();
                }}
                onChange={(event) =>
                  field.onChange(
                    event.target.value
                      .split(",")
                      .map((domain) => domain.trim())
                  )
                }
              />
            )}
          />
        </Field>
        <Field
          error={fieldError(form.formState, "irreversibleActionScopesJson")}
          hint={'JSON examples: {"kind":"HTTP","method":"POST","origin":"https://staging.example.com","path":"/orders","maxUses":1}. A DOM CLICK additionally requires one unique id/data-testid/name/aria-label submit target whose signed form.method/origin/path matches an HTTP POST scope.'}
          htmlFor="test-action-scopes"
          label="Exact irreversible action scopes"
        >
          <Textarea
            id="test-action-scopes"
            invalid={Boolean(form.formState.errors.irreversibleActionScopesJson)}
            rows={7}
            {...form.register("irreversibleActionScopesJson")}
          />
        </Field>
        <Controller
          control={form.control}
          name="testDataAttested"
          render={({ field }) => (
            <div className="flex items-start gap-3 rounded-md border border-warn-600/20 bg-warn-50 p-3">
              <Toggle
                aria-label="Attest staging and test data only"
                checked={field.value}
                id="test-data-attested"
                onBlur={field.onBlur}
                onCheckedChange={field.onChange}
              />
              <label className="text-sm text-zinc-700" htmlFor="test-data-attested">
                {irreversibleApprovalCopy}
              </label>
            </div>
          )}
        />
      </Card>

      <Card title="Device">
        <fieldset>
          <legend className="sr-only">Browser device</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: Monitor, label: "Desktop — 1440 × 900", value: "DESKTOP" as const },
              { icon: Smartphone, label: "Mobile — 390 × 844", value: "MOBILE" as const },
            ].map((option) => {
              const Icon = option.icon;
              const active = selectedDevice === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                    active
                      ? "border-accent-600 bg-accent-50 text-accent-700"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    value={option.value}
                    {...form.register("device")}
                  />
                  <Icon aria-hidden="true" className="size-5" />
                  <span className="font-medium">{option.label}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Schedule">
          <Field
            error={fieldError(form.formState, "intervalHours")}
            hint={timeoutHelpCopy}
            htmlFor="test-interval"
            label="Run frequency"
            required
          >
            <Select
              id="test-interval"
              invalid={Boolean(form.formState.errors.intervalHours)}
              {...form.register("intervalHours", { valueAsNumber: true })}
            >
              {intervalOptions.map((hours) => (
                <option key={hours} value={hours}>
                  Every {hours} {hours === 1 ? "hour" : "hours"}
                </option>
              ))}
            </Select>
          </Field>
        </Card>

        <Card title="Retries">
          <Field
            error={fieldError(form.formState, "maxRetries")}
            hint="Retries run in a fresh browser and don't consume runs."
            htmlFor="test-retries"
            label="Retry failed attempts"
          >
            <Select
              id="test-retries"
              invalid={Boolean(form.formState.errors.maxRetries)}
              {...form.register("maxRetries", { valueAsNumber: true })}
            >
              {[0, 1, 2, 3].map((retries) => (
                <option key={retries} value={retries}>
                  {retryOptionLabel(retries)}
                </option>
              ))}
            </Select>
          </Field>
        </Card>
      </div>

      <Controller
        control={form.control}
        name="channelIds"
        render={({ field }) => (
          <ChannelPicker
            channels={channels.data ?? []}
            error={channels.isError}
            loading={channels.isPending}
            manageHref={`/w/${current.id}/alerts`}
            value={field.value}
            onChange={field.onChange}
            onRetry={() => void channels.refetch()}
          />
        )}
      />

      <Controller
        control={form.control}
        name="notifyOnRecovery"
        render={({ field }) => (
          <RecoveryToggle
            checked={field.value}
            id="test-recovery"
            resource="test"
            onBlur={field.onBlur}
            onCheckedChange={field.onChange}
          />
        )}
      />

      <Card title="Test it">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-700">{runCostCopy}</p>
            <p className="mt-1 text-xs text-zinc-500">
              You can leave this page while it runs; the run continues server-side. Saving never requires a successful test run.
            </p>
          </div>
          <Button
            disabled={!form.formState.isValid || validationRunning}
            loading={validation.isPending}
            onClick={() => void runValidation()}
          >
            Test it
          </Button>
        </div>
        {validationRunId ? (
          <div className="mt-4 border-t border-zinc-200 pt-4">
            <RunStatusPanel
              compact
              runId={validationRunId}
              wsId={current.id}
              onTerminal={() => setValidationRunning(false)}
            />
          </div>
        ) : null}
      </Card>

      {form.formState.errors.root?.message ? (
        <p className="text-sm text-danger-600" role="alert">
          {form.formState.errors.root.message}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Link
          className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          to={editing ? `/w/${current.id}/tests/${testId}` : `/w/${current.id}/tests`}
        >
          Cancel
        </Link>
        <Button loading={form.formState.isSubmitting} type="submit" variant="primary">
          {editing ? "Save changes" : "Save test"}
        </Button>
      </div>
    </form>
  );
}
