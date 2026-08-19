import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, Smartphone, TriangleAlert } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { listChannels } from "../../api/channels";
import { createTest, getTest, updateTest, validateDraft } from "../../api/tests";
import type { BrowserTestInput } from "../../api/types";
import { ChannelPicker } from "../../components/ChannelPicker";
import { RecoveryToggle } from "../../components/RecoveryToggle";
import { RunStatusPanel } from "../../components/RunStatusPanel";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { PageHeader } from "../../components/ui/PageHeader";
import { Select } from "../../components/ui/Select";
import { Spinner } from "../../components/ui/Spinner";
import { Textarea } from "../../components/ui/Textarea";
import { fieldError } from "../../components/ui/form";
import { useToast } from "../../contexts/ToastContext";
import { useWorkspace } from "../../contexts/WorkspaceContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";
import { runCostCopy } from "./hooks";

export const stagingCredentialsCopy =
  "Use staging or test credentials only. Never use personal accounts, real cards, or credentials with destructive permissions.";
export const timeoutHelpCopy =
  "Each attempt can run for up to 5 minutes. If it takes longer, it ends with a Timeout status and may be retried according to your settings.";
export const tokenNoteCopy =
  "Tests are designed for a nominal maximum of 200,000 tokens. If a test is very large, split it into smaller tests.";

export const testFormSchema = z.object({
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
});

type TestFormValues = z.infer<typeof testFormSchema>;

export const intervalOptions = Array.from({ length: 24 }, (_, index) => index + 1);

export function retryOptionLabel(retries: number): string {
  if (retries === 0) return "0 retries — no retries";
  const delays = ["immediately", "after 1 min", "after 2 min"].slice(0, retries);
  return `${retries} ${retries === 1 ? "retry" : "retries"} — ${delays.join(", ")}`;
}

const defaults: TestFormValues = {
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

  useEffect(() => {
    if (!test.data) return;
    form.reset({
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
    mutationFn: (values: BrowserTestInput) => validateDraft(current.id, values),
  });

  const runValidation = async () => {
    const valid = await form.trigger();
    if (!valid || validationRunning) return;
    try {
      setValidationRunId(null);
      const result = await validation.mutateAsync(form.getValues());
      setValidationRunId(result.runId);
      setValidationRunning(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === "BILLING_REQUIRED") {
        toast.error("Billing required — set up your subscription first.");
      } else {
        toast.error(apiErrorMessage(error));
      }
    }
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const saved = editing
        ? await updateTest(current.id, testId ?? "", values)
        : await createTest(current.id, values);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success(editing ? "Changes saved" : "Test created — first run scheduled");
      navigate(`/w/${current.id}/tests/${saved.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "BILLING_REQUIRED") {
        toast.error("Billing required — set up your subscription first.");
        return;
      }
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          if (detail.field in defaults) {
            form.setError(detail.field as keyof TestFormValues, { message: detail.message });
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
  if (editing && test.isError) return <ErrorState onRetry={() => void test.refetch()} />;

  const selectedDevice = form.watch("device");

  return (
    <form className="space-y-6" noValidate onSubmit={(event) => void submit(event)}>
      <PageHeader
        description={editing ? "Update the flow, schedule, and notifications." : "Describe a flow for Zenguy to verify in a real browser."}
        title={editing ? "Edit browser test" : "New browser test"}
      />

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
            manageHref={`/w/${current.id}/notifications`}
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
