import { Feather } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { Pressable, StyleSheet, View } from "react-native";

import { listChannels } from "@/api/channels";
import type { BodyCondition, Monitor, MonitorInput, TestRequestResult } from "@/api/types";
import { createMonitor, testRequest as sendTestRequest, updateMonitor } from "@/api/uptime";
import { ChannelPicker } from "@/components/ChannelPicker";
import { FormError } from "@/components/FormError";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { colors, spacing } from "@/theme";
import {
  Button,
  Caption,
  Card,
  Field,
  Input,
  Label,
  Mono,
  Muted,
  SelectSheet,
  Small,
  Toggle,
} from "@/ui";

import { KeyValueEditor } from "./KeyValueEditor";
import { keyValueListError, keyValueRowErrors } from "./key-value";
import { monitorHref, uptimeHref } from "./links";
import {
  bodyConditionOptions,
  defaultChannelIds,
  frequencyOptions,
  headersMaskedNote,
  isMonitorFormField,
  methodOptions,
  monitorFormDefaults,
  monitorFormSchema,
  monitorToFormValues,
  retryOptions,
  supportsBody,
  testRequestNote,
  toMonitorInput,
  uptimeCostNote,
  type MonitorFormValues,
} from "./monitor-form";
import { NumberInput } from "./NumberInput";

const frequencySelectOptions = frequencyOptions.map((option) => ({
  label: option.label,
  value: option.value as number,
}));

function TestRequestOutcome({ result }: { result: TestRequestResult }) {
  const [excerptOpen, setExcerptOpen] = useState(false);
  const fg = result.passed ? colors.okDark : colors.dangerDark;
  return (
    <Card style={styles.result} tone={result.passed ? "ok" : "danger"}>
      <View style={styles.resultHeadline}>
        <Feather color={fg} name={result.passed ? "check" : "x"} size={16} />
        <Label color={fg} style={styles.resultText}>
          {result.passed
            ? `${result.httpStatus ?? "—"} in ${result.responseTimeMs} ms`
            : (result.failureReason ?? "Request failed")}
        </Label>
      </View>
      {result.conditions.length > 0 ? (
        <View style={styles.conditions}>
          {result.conditions.map((condition, index) => (
            <View key={`${condition.type}-${index}`} style={styles.conditionRow}>
              <Small color={condition.passed ? colors.okDark : colors.dangerDark}>
                {condition.passed ? "✓" : "✗"}
              </Small>
              <Small color={colors.textBody} style={styles.conditionText}>
                {condition.type} — {condition.detail}
              </Small>
            </View>
          ))}
        </View>
      ) : null}
      {result.responseExcerpt ? (
        <View style={styles.excerpt}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: excerptOpen }}
            style={styles.excerptToggle}
            onPress={() => setExcerptOpen((open) => !open)}
          >
            <Feather color={colors.textBody} name={excerptOpen ? "chevron-down" : "chevron-right"} size={14} />
            <Caption color={colors.textBody} style={styles.excerptLabel}>
              Response excerpt
            </Caption>
          </Pressable>
          {excerptOpen ? (
            <Mono color={colors.textBody} selectable style={styles.excerptText}>
              {result.responseExcerpt}
            </Mono>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/** Create/edit form shared by the "New monitor" and "Edit monitor" screens. */
export function MonitorForm({ monitor }: { monitor?: Monitor }) {
  const editing = monitor !== undefined;
  const headersMasked = monitor?.headersMasked ?? false;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const handleMutationError = useMutationError();
  const { current } = useWorkspace();
  const channels = useQuery({
    enabled: !editing,
    queryFn: () => listChannels(current.id),
    queryKey: ["ws", current.id, "channels"],
  });
  const form = useForm<MonitorFormValues>({
    defaultValues: monitor ? monitorToFormValues(monitor) : monitorFormDefaults,
    mode: "onChange",
    resolver: zodResolver(monitorFormSchema),
  });
  const requestTest = useMutation({
    mutationFn: (values: MonitorInput) => sendTestRequest(current.id, values),
  });

  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (editing || appliedDefaults.current || !channels.data) return;
    appliedDefaults.current = true;
    if (form.getValues("channelIds").length === 0) {
      form.setValue("channelIds", defaultChannelIds(channels.data));
    }
  }, [channels.data, editing, form]);

  // Like the web, the form follows the monitor the API returns — but only when
  // it actually changed, so a background refetch never discards edits.
  const appliedVersion = useRef<string | null>(null);
  useEffect(() => {
    if (!monitor) return;
    const version = `${monitor.id}:${monitor.updatedAt}`;
    if (appliedVersion.current === version) return;
    appliedVersion.current = version;
    form.reset(monitorToFormValues(monitor));
  }, [form, monitor]);

  const runTestRequest = async () => {
    requestTest.reset();
    if (!(await form.trigger())) return;
    try {
      await requestTest.mutateAsync(toMonitorInput(form.getValues(), { headersMasked }));
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const input = toMonitorInput(values, { headersMasked });
      const saved = monitor
        ? await updateMonitor(current.id, monitor.id, input)
        : await createMonitor(current.id, input);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "monitors"] });
      toast.success(editing ? "Changes saved" : "Monitor created");
      router.replace(monitorHref(current.id, saved.id));
    } catch (error) {
      if (handleMutationError(error)) return;
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          if (isMonitorFormField(detail.field)) {
            form.setError(detail.field, { message: detail.message });
            handled = true;
          }
        }
        if (handled) return;
      }
      form.setError("root", { message: apiErrorMessage(error) });
    }
  });

  const cancel = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(monitor ? monitorHref(current.id, monitor.id) : uptimeHref(current.id));
  };

  const method = useWatch({ control: form.control, name: "method" });
  const condition = useWatch({ control: form.control, name: "bodyCondition" });
  const showBody = supportsBody(method);
  const headerErrors = form.formState.errors.headers;
  const headersListError = keyValueListError(headerErrors);

  return (
    <View style={styles.stack}>
      <Muted>
        {editing
          ? "Update the request, schedule, and notifications."
          : "Watch an endpoint without consuming browser test runs."}
      </Muted>

      <Card eyebrow="Request">
        <View style={styles.fields}>
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Name" required>
                <Input
                  autoCapitalize="sentences"
                  autoCorrect={false}
                  invalid={Boolean(fieldState.error)}
                  placeholder="Public API"
                  returnKeyType="next"
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="method"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Method" required>
                <SelectSheet
                  invalid={Boolean(fieldState.error)}
                  options={methodOptions}
                  title="Method"
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="url"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="URL" required>
                <Input
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  inputMode="url"
                  invalid={Boolean(fieldState.error)}
                  keyboardType="url"
                  mono
                  placeholder="https://api.example.com/health"
                  textContentType="URL"
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                />
              </Field>
            )}
          />
          <View style={styles.headers}>
            <Label color={colors.textBody}>Headers</Label>
            {headersMasked ? (
              <Muted>{headersMaskedNote}</Muted>
            ) : (
              <Controller
                control={form.control}
                name="headers"
                render={({ field }) => (
                  <KeyValueEditor
                    errors={keyValueRowErrors(headerErrors)}
                    keyPlaceholder="Header name"
                    value={field.value}
                    valuePlaceholder="Value"
                    onChange={field.onChange}
                  />
                )}
              />
            )}
            <Caption>
              Values support secrets:{" "}
              <Mono color={colors.textMuted} style={styles.inlineMono}>
                Authorization: Bearer {"{{API_TOKEN}}"}
              </Mono>
            </Caption>
            {headersListError ? (
              <Caption accessibilityRole="alert" color={colors.dangerDark}>
                {headersListError}
              </Caption>
            ) : null}
          </View>
          {showBody ? (
            <Controller
              control={form.control}
              name="body"
              render={({ field, fieldState }) => (
                <Field
                  error={fieldState.error?.message}
                  hint="Raw text or JSON. Set a Content-Type header if needed."
                  label="Body"
                >
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    invalid={Boolean(fieldState.error)}
                    mono
                    multiline
                    value={field.value}
                    onBlur={field.onBlur}
                    onChangeText={field.onChange}
                  />
                </Field>
              )}
            />
          ) : null}
        </View>
      </Card>

      <Card eyebrow="Expectations">
        <View style={styles.fields}>
          <Controller
            control={form.control}
            name="expectedStatus"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Expected status" required>
                <NumberInput
                  invalid={Boolean(fieldState.error)}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="bodyCondition"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Body condition">
                <SelectSheet<BodyCondition | "">
                  invalid={Boolean(fieldState.error)}
                  options={bodyConditionOptions}
                  title="Body condition"
                  value={field.value ?? ""}
                  onChange={(value) => field.onChange(value || null)}
                />
              </Field>
            )}
          />
          {condition !== null ? (
            <Controller
              control={form.control}
              name="bodyExpectedValue"
              render={({ field, fieldState }) => (
                <Field error={fieldState.error?.message} label="Value" required>
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    invalid={Boolean(fieldState.error)}
                    mono
                    value={field.value}
                    onBlur={field.onBlur}
                    onChangeText={field.onChange}
                  />
                </Field>
              )}
            />
          ) : null}
          {condition === "JSON_PATH_EQUALS" ? (
            <Controller
              control={form.control}
              name="bodyConditionPath"
              render={({ field, fieldState }) => (
                <Field error={fieldState.error?.message} label="JSON path" required>
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    invalid={Boolean(fieldState.error)}
                    mono
                    placeholder="$.status.healthy"
                    value={field.value}
                    onBlur={field.onBlur}
                    onChangeText={field.onChange}
                  />
                </Field>
              )}
            />
          ) : null}
        </View>
      </Card>

      <Card eyebrow="Schedule">
        <View style={styles.fields}>
          <Controller
            control={form.control}
            name="frequencySeconds"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Frequency" required>
                <SelectSheet
                  invalid={Boolean(fieldState.error)}
                  options={frequencySelectOptions}
                  searchable={false}
                  title="Frequency"
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="timeoutSeconds"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} hint="seconds" label="Timeout" required>
                <NumberInput
                  invalid={Boolean(fieldState.error)}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="maxRetries"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} label="Retries">
                <SelectSheet
                  invalid={Boolean(fieldState.error)}
                  options={retryOptions}
                  title="Retries"
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <Caption>{uptimeCostNote}</Caption>
        </View>
      </Card>

      <Controller
        control={form.control}
        name="channelIds"
        render={({ field }) => <ChannelPicker value={field.value} onChange={field.onChange} />}
      />

      <Controller
        control={form.control}
        name="notifyOnRecovery"
        render={({ field }) => (
          <Card eyebrow="Recovery">
            <Toggle
              description="Send a recovery notification after an open incident passes."
              label="Notify when this monitor recovers"
              value={field.value}
              onValueChange={field.onChange}
            />
          </Card>
        )}
      />

      <Card eyebrow="Test request">
        <View style={styles.fields}>
          <Small color={colors.textMuted}>{testRequestNote}</Small>
          <Button
            icon={<Feather color={colors.ink} name="send" size={15} />}
            loading={requestTest.isPending}
            title="Send test request"
            onPress={() => void runTestRequest()}
          />
          {requestTest.data ? <TestRequestOutcome result={requestTest.data} /> : null}
        </View>
      </Card>

      <FormError message={form.formState.errors.root?.message} />

      <View style={styles.actions}>
        <Button title="Cancel" onPress={cancel} />
        <Button
          loading={form.formState.isSubmitting}
          title={editing ? "Save changes" : "Save monitor"}
          variant="accent"
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  conditionRow: { flexDirection: "row", gap: spacing.sm },
  conditionText: { flex: 1 },
  conditions: { gap: spacing.xs + 2, marginTop: spacing.md },
  excerpt: { marginTop: spacing.md },
  excerptLabel: { fontWeight: "500" },
  excerptText: { fontSize: 12, lineHeight: 16, marginTop: spacing.sm },
  excerptToggle: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  fields: { gap: spacing.lg },
  headers: { gap: spacing.sm },
  inlineMono: { fontSize: 12 },
  result: { marginTop: spacing.xs },
  resultHeadline: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  resultText: { flex: 1, fontWeight: "600" },
  stack: { gap: spacing.xl },
});
