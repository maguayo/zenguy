import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Send, X } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { z } from "zod";

import { listChannels } from "../../api/channels";
import {
  createMonitor,
  getMonitor,
  testRequest as sendTestRequest,
  updateMonitor,
} from "../../api/uptime";
import type { Monitor, MonitorInput } from "../../api/types";
import { ChannelPicker } from "../../components/ChannelPicker";
import { KeyValueEditor } from "../../components/KeyValueEditor";
import { RecoveryToggle } from "../../components/RecoveryToggle";
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
import { useMutationError } from "../../hooks/useMutationError";
import { ApiError } from "../../lib/api";
import { apiErrorMessage, itemQueryErrorMessage } from "../../lib/errors";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const bodyConditions = ["CONTAINS", "NOT_CONTAINS", "EQUALS", "JSON_PATH_EQUALS"] as const;
const allowedFrequencies = [300, 600, 900, 1_800, 3_600, 10_800, 21_600, 43_200, 86_400] as const;

export const monitorFormSchema = z
  .object({
    body: z.string().max(16_384, "Body must be 16,384 characters or fewer."),
    bodyCondition: z.enum(bodyConditions).nullable(),
    bodyConditionPath: z.string().max(256, "JSON path must be 256 characters or fewer."),
    bodyExpectedValue: z.string().max(2_048, "Value must be 2,048 characters or fewer."),
    channelIds: z.array(z.string()).max(10),
    expectedStatus: z.number().int().min(100).max(599),
    frequencySeconds: z
      .number()
      .int()
      .refine((value) => allowedFrequencies.includes(value as (typeof allowedFrequencies)[number]), {
        message: "Choose a supported frequency.",
      }),
    headers: z
      .array(
        z.object({
          key: z
            .string()
            .trim()
            .min(1, "Header name is required.")
            .max(64)
            .regex(/^[A-Za-z0-9-]+$/u, "Use letters, numbers, and hyphens only."),
          value: z.string().max(2_048),
        }),
      )
      .max(20),
    maxRetries: z.number().int().min(0).max(3),
    method: z.enum(methods),
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(120, "Name must be 120 characters or fewer."),
    notifyOnRecovery: z.boolean(),
    timeoutSeconds: z.number().int().min(1).max(30),
    url: z
      .string()
      .url("Enter a valid URL.")
      .refine((value) => /^https?:\/\//iu.test(value), "URL must start with http:// or https://."),
  })
  .superRefine((values, context) => {
    if ((values.method === "GET" || values.method === "HEAD") && values.body.trim()) {
      context.addIssue({
        code: "custom",
        message: `Body is not allowed for ${values.method}.`,
        path: ["body"],
      });
    }
    if (values.bodyCondition !== null && !values.bodyExpectedValue.trim()) {
      context.addIssue({
        code: "custom",
        message: "Value is required when a body condition is set.",
        path: ["bodyExpectedValue"],
      });
    }
    if (values.bodyCondition === null && values.bodyExpectedValue.trim()) {
      context.addIssue({
        code: "custom",
        message: "Choose a body condition before entering a value.",
        path: ["bodyExpectedValue"],
      });
    }
    if (values.bodyCondition === "JSON_PATH_EQUALS" && !values.bodyConditionPath.trim()) {
      context.addIssue({
        code: "custom",
        message: "JSON path is required for JSON path equals.",
        path: ["bodyConditionPath"],
      });
    }
    if (values.bodyCondition !== "JSON_PATH_EQUALS" && values.bodyConditionPath.trim()) {
      context.addIssue({
        code: "custom",
        message: "JSON path is only available for JSON path equals.",
        path: ["bodyConditionPath"],
      });
    }
  });

export type MonitorFormValues = z.infer<typeof monitorFormSchema>;

export const frequencyOptions = [
  { label: "Every 5 min", value: 300 },
  { label: "Every 10 min", value: 600 },
  { label: "Every 15 min", value: 900 },
  { label: "Every 30 min", value: 1_800 },
  { label: "Every 1 hour", value: 3_600 },
  { label: "Every 3 hours", value: 10_800 },
  { label: "Every 6 hours", value: 21_600 },
  { label: "Every 12 hours", value: 43_200 },
  { label: "Every 24 hours", value: 86_400 },
] as const;

export const testRequestNote =
  "Runs the request once from Zenguy. Nothing is saved and no runs are consumed.";
export const uptimeCostNote = "Uptime checks and retries never consume browser test runs.";

export function monitorRetryOptionLabel(retries: number): string {
  if (retries === 0) return "0 retries — no retries";
  const delays = ["immediately", "after 1 min", "after 2 min"].slice(0, retries);
  return `${retries} ${retries === 1 ? "retry" : "retries"} — ${delays.join(", ")}`;
}

const defaults: MonitorFormValues = {
  body: "",
  bodyCondition: null,
  bodyConditionPath: "",
  bodyExpectedValue: "",
  channelIds: [],
  expectedStatus: 200,
  frequencySeconds: 300,
  headers: [],
  maxRetries: 1,
  method: "GET",
  name: "",
  notifyOnRecovery: true,
  timeoutSeconds: 10,
  url: "",
};

export function monitorToFormValues(monitor: Monitor): MonitorFormValues {
  return {
    body: monitor.body ?? "",
    bodyCondition: monitor.bodyCondition ?? null,
    bodyConditionPath: monitor.bodyConditionPath ?? "",
    bodyExpectedValue: monitor.bodyExpectedValue ?? "",
    channelIds: monitor.channelIds,
    expectedStatus: monitor.expectedStatus,
    frequencySeconds: monitor.frequencySeconds,
    headers: monitor.headers ?? [],
    maxRetries: monitor.maxRetries,
    method: monitor.method,
    name: monitor.name,
    notifyOnRecovery: monitor.notifyOnRecovery,
    timeoutSeconds: monitor.timeoutSeconds,
    url: monitor.url,
  };
}

export function toMonitorInput(values: MonitorFormValues): MonitorInput {
  const supportsBody = values.method !== "GET" && values.method !== "HEAD";
  return {
    ...(supportsBody && values.body.length > 0 ? { body: values.body } : {}),
    bodyCondition: values.bodyCondition,
    bodyConditionPath:
      values.bodyCondition === "JSON_PATH_EQUALS" ? values.bodyConditionPath.trim() : null,
    bodyExpectedValue:
      values.bodyCondition === null ? null : values.bodyExpectedValue,
    channelIds: values.channelIds,
    expectedStatus: values.expectedStatus,
    frequencySeconds: values.frequencySeconds as MonitorInput["frequencySeconds"],
    headers: values.headers,
    maxRetries: values.maxRetries,
    method: values.method,
    name: values.name.trim(),
    notifyOnRecovery: values.notifyOnRecovery,
    timeoutSeconds: values.timeoutSeconds,
    url: values.url,
  };
}

export default function MonitorFormPage() {
  const { monitorId } = useParams();
  const editing = Boolean(monitorId);
  const { can, current } = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const handleMutationError = useMutationError();
  const allowed = can("uptime.manage");
  const monitor = useQuery({
    enabled: editing && allowed,
    queryFn: () => getMonitor(current.id, monitorId ?? ""),
    queryKey: ["ws", current.id, "monitors", monitorId],
  });
  const channels = useQuery({
    enabled: allowed,
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const form = useForm<MonitorFormValues>({
    defaultValues: defaults,
    mode: "onChange",
    resolver: zodResolver(monitorFormSchema),
  });
  const requestTest = useMutation({
    mutationFn: (values: MonitorInput) => sendTestRequest(current.id, values),
  });

  useEffect(() => {
    if (monitor.data) form.reset(monitorToFormValues(monitor.data));
  }, [form, monitor.data]);

  const runTestRequest = async () => {
    requestTest.reset();
    if (!(await form.trigger())) return;
    try {
      await requestTest.mutateAsync(toMonitorInput(form.getValues()));
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const input = toMonitorInput(values);
      const saved = editing
        ? await updateMonitor(current.id, monitorId ?? "", input)
        : await createMonitor(current.id, input);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "monitors"] });
      toast.success(editing ? "Changes saved" : "Monitor created");
      navigate(`/w/${current.id}/uptime/${saved.id}`);
    } catch (error) {
      if (handleMutationError(error)) return;
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          if (detail.field in defaults) {
            form.setError(detail.field as keyof MonitorFormValues, { message: detail.message });
            handled = true;
          }
        }
        if (handled) return;
      }
      form.setError("root", { message: apiErrorMessage(error) });
    }
  });

  if (!allowed) return <Navigate replace to={`/w/${current.id}/uptime`} />;
  if (editing && monitor.isPending) {
    return (
      <div className="grid min-h-64 place-items-center">
        <Spinner label="Loading uptime monitor" size={6} />
      </div>
    );
  }
  if (editing && monitor.isError) {
    return (
      <ErrorState
        message={itemQueryErrorMessage(monitor.error)}
        onRetry={() => void monitor.refetch()}
      />
    );
  }

  const method = form.watch("method");
  const condition = form.watch("bodyCondition");
  const showBody = method !== "GET" && method !== "HEAD";

  return (
    <form className="space-y-6" noValidate onSubmit={(event) => void submit(event)}>
      <PageHeader
        description={editing ? "Update the request, schedule, and notifications." : "Watch an endpoint without consuming browser test runs."}
        title={editing ? "Edit monitor" : "New monitor"}
      />

      <Card title="Request">
        <div className="space-y-4">
          <Field error={fieldError(form.formState, "name")} htmlFor="monitor-name" label="Name" required>
            <Input
              id="monitor-name"
              invalid={Boolean(form.formState.errors.name)}
              placeholder="Checkout API"
              {...form.register("name")}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field error={fieldError(form.formState, "method")} htmlFor="monitor-method" label="Method" required>
              <Select id="monitor-method" {...form.register("method")}>
                {methods.map((value) => <option key={value}>{value}</option>)}
              </Select>
            </Field>
            <Field error={fieldError(form.formState, "url")} htmlFor="monitor-url" label="URL" required>
              <Input
                id="monitor-url"
                invalid={Boolean(form.formState.errors.url)}
                placeholder="https://api.example.com/health"
                type="url"
                {...form.register("url")}
              />
            </Field>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-zinc-900">Headers</p>
            <Controller
              control={form.control}
              name="headers"
              render={({ field }) => (
                <KeyValueEditor
                  keyPlaceholder="Header name"
                  value={field.value}
                  valuePlaceholder="Value"
                  onChange={field.onChange}
                />
              )}
            />
            <p className="text-xs text-zinc-500">
              Values support secrets: <span className="font-mono">Authorization: Bearer {"{{API_TOKEN}}"}</span>
            </p>
            {fieldError(form.formState, "headers") ? (
              <p className="text-xs text-danger-600" role="alert">{fieldError(form.formState, "headers")}</p>
            ) : null}
          </div>
          {showBody ? (
            <Field
              error={fieldError(form.formState, "body")}
              hint="Raw text or JSON. Set a Content-Type header if needed."
              htmlFor="monitor-body"
              label="Body"
            >
              <Textarea
                className="font-mono"
                id="monitor-body"
                invalid={Boolean(form.formState.errors.body)}
                rows={6}
                {...form.register("body")}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title="Expectations">
        <div className="grid gap-4 md:grid-cols-2">
          <Field error={fieldError(form.formState, "expectedStatus")} htmlFor="monitor-status" label="Expected status" required>
            <Input
              id="monitor-status"
              invalid={Boolean(form.formState.errors.expectedStatus)}
              max={599}
              min={100}
              type="number"
              {...form.register("expectedStatus", { valueAsNumber: true })}
            />
          </Field>
          <Field error={fieldError(form.formState, "bodyCondition")} htmlFor="monitor-condition" label="Body condition">
            <Controller
              control={form.control}
              name="bodyCondition"
              render={({ field }) => (
                <Select
                  id="monitor-condition"
                  value={field.value ?? ""}
                  onBlur={field.onBlur}
                  onChange={(event) => field.onChange(event.target.value || null)}
                >
                  <option value="">None</option>
                  <option value="CONTAINS">Body contains</option>
                  <option value="NOT_CONTAINS">Body does not contain</option>
                  <option value="EQUALS">Body equals</option>
                  <option value="JSON_PATH_EQUALS">JSON path equals</option>
                </Select>
              )}
            />
          </Field>
          {condition !== null ? (
            <Field error={fieldError(form.formState, "bodyExpectedValue")} htmlFor="monitor-expected-value" label="Value" required>
              <Input
                id="monitor-expected-value"
                invalid={Boolean(form.formState.errors.bodyExpectedValue)}
                {...form.register("bodyExpectedValue")}
              />
            </Field>
          ) : null}
          {condition === "JSON_PATH_EQUALS" ? (
            <Field error={fieldError(form.formState, "bodyConditionPath")} htmlFor="monitor-json-path" label="JSON path" required>
              <Input
                className="font-mono"
                id="monitor-json-path"
                invalid={Boolean(form.formState.errors.bodyConditionPath)}
                placeholder="$.status.healthy"
                {...form.register("bodyConditionPath")}
              />
            </Field>
          ) : null}
        </div>
      </Card>

      <Card title="Schedule">
        <div className="grid gap-4 md:grid-cols-3">
          <Field error={fieldError(form.formState, "frequencySeconds")} htmlFor="monitor-frequency" label="Frequency" required>
            <Select id="monitor-frequency" {...form.register("frequencySeconds", { valueAsNumber: true })}>
              {frequencyOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </Field>
          <Field error={fieldError(form.formState, "timeoutSeconds")} hint="seconds" htmlFor="monitor-timeout" label="Timeout" required>
            <Input
              id="monitor-timeout"
              invalid={Boolean(form.formState.errors.timeoutSeconds)}
              max={30}
              min={1}
              type="number"
              {...form.register("timeoutSeconds", { valueAsNumber: true })}
            />
          </Field>
          <Field error={fieldError(form.formState, "maxRetries")} htmlFor="monitor-retries" label="Retries">
            <Select id="monitor-retries" {...form.register("maxRetries", { valueAsNumber: true })}>
              {[0, 1, 2, 3].map((retries) => (
                <option key={retries} value={retries}>{monitorRetryOptionLabel(retries)}</option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="mt-3 text-xs text-zinc-500">{uptimeCostNote}</p>
      </Card>

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
            id="monitor-recovery"
            resource="monitor"
            onBlur={field.onBlur}
            onCheckedChange={field.onChange}
          />
        )}
      />

      <Card title="Test request">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-600">{testRequestNote}</p>
          <Button loading={requestTest.isPending} onClick={() => void runTestRequest()}>
            <Send aria-hidden="true" className="size-4" />
            Send test request
          </Button>
        </div>
        {requestTest.data ? (
          <Card
            className={`mt-4 ${requestTest.data.passed ? "border-ok-600/30 bg-ok-50" : "border-danger-600/30 bg-danger-50"}`}
          >
            <p className={`flex items-center gap-2 text-sm font-semibold ${requestTest.data.passed ? "text-ok-700" : "text-danger-700"}`}>
              {requestTest.data.passed ? <Check aria-hidden="true" className="size-4" /> : <X aria-hidden="true" className="size-4" />}
              {requestTest.data.passed
                ? `${requestTest.data.httpStatus ?? "—"} in ${requestTest.data.responseTimeMs} ms`
                : requestTest.data.failureReason ?? "Request failed"}
            </p>
            {requestTest.data.conditions.length > 0 ? (
              <ul className="mt-3 space-y-1.5 text-sm text-zinc-700">
                {requestTest.data.conditions.map((conditionResult, index) => (
                  <li className="flex items-start gap-2" key={`${conditionResult.type}-${index}`}>
                    <span className={conditionResult.passed ? "text-ok-700" : "text-danger-700"}>
                      {conditionResult.passed ? "✓" : "✗"}
                    </span>
                    <span>{conditionResult.type} — {conditionResult.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {requestTest.data.responseExcerpt ? (
              <details className="mt-3 rounded-md border border-zinc-200 bg-white p-3">
                <summary className="cursor-pointer text-xs font-medium text-zinc-700">Response excerpt</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-700">{requestTest.data.responseExcerpt}</pre>
              </details>
            ) : null}
          </Card>
        ) : null}
      </Card>

      {form.formState.errors.root?.message ? (
        <p className="text-sm text-danger-600" role="alert">{form.formState.errors.root.message}</p>
      ) : null}

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-zinc-50/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <Link
          className="inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          to={editing ? `/w/${current.id}/uptime/${monitorId}` : `/w/${current.id}/uptime`}
        >
          Cancel
        </Link>
        <Button loading={form.formState.isSubmitting} type="submit" variant="primary">
          {editing ? "Save changes" : "Save monitor"}
        </Button>
      </div>
    </form>
  );
}
