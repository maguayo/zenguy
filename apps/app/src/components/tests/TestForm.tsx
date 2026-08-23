import { Feather } from "@expo/vector-icons";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, View } from "react-native";

import { listChannels } from "@/api/channels";
import { createTest, getTest, updateTest, validateDraft } from "@/api/tests";
import type { BrowserTestInput, Device } from "@/api/types";
import { ChannelPicker } from "@/components/ChannelPicker";
import { FormError } from "@/components/FormError";
import { useToast } from "@/contexts/ToastContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useMutationError } from "@/hooks/useMutationError";
import { ApiError } from "@/lib/api";
import { apiErrorMessage, itemQueryErrorMessage } from "@/lib/errors";
import { colors, palette, radius, spacing } from "@/theme";
import {
  Body,
  Button,
  Caption,
  Card,
  Divider,
  ErrorState,
  Field,
  IconTile,
  Input,
  Label,
  Muted,
  Screen,
  SelectSheet,
  Small,
  Spinner,
  Toggle,
} from "@/ui";
import { RunStatusPanel } from "./RunStatusPanel";
import {
  defaultChannelIds,
  instructionsHint,
  intervalOptionLabel,
  intervalOptions,
  isTestFormField,
  retriesHint,
  retryOptionLabel,
  retryOptions,
  stagingCredentialsCopy,
  testFormDefaults,
  testFormSchema,
  testFormValues,
  timeoutHelpCopy,
  tokenNoteCopy,
  validationNote,
  type TestFormValues,
} from "./test-form";
import { runCostCopy } from "./useRunNow";

type FeatherName = ComponentProps<typeof Feather>["name"];

const deviceOptions: { icon: FeatherName; label: string; value: Device }[] = [
  { icon: "monitor", label: "Desktop — 1440 × 900", value: "DESKTOP" },
  { icon: "smartphone", label: "Mobile — 390 × 844", value: "MOBILE" },
];

/** Create/edit form for a browser test, mirroring the web's TestFormPage. */
export function TestForm({ testId }: { testId?: string }) {
  const editing = testId !== undefined;
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const handleMutationError = useMutationError();
  const { can, current } = useWorkspace();
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
    defaultValues: { ...testFormDefaults },
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
    form.reset(testFormValues(test.data));
  }, [form, test.data]);

  const validation = useMutation({
    mutationFn: (values: BrowserTestInput) => validateDraft(current.id, values),
  });
  const stopValidation = useCallback(() => setValidationRunning(false), []);

  const runValidation = async () => {
    const valid = await form.trigger();
    if (!valid || validationRunning) return;
    try {
      setValidationRunId(null);
      const result = await validation.mutateAsync(form.getValues());
      setValidationRunId(result.runId);
      setValidationRunning(true);
    } catch (error) {
      if (!handleMutationError(error)) toast.error(apiErrorMessage(error));
    }
  };

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const saved = editing
        ? await updateTest(current.id, testId, values)
        : await createTest(current.id, values);
      await queryClient.invalidateQueries({ queryKey: ["ws", current.id, "tests"] });
      toast.success(editing ? "Changes saved" : "Test created — first run scheduled");
      router.replace(`/w/${current.id}/tests/${saved.id}`);
    } catch (error) {
      if (handleMutationError(error)) return;
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          if (isTestFormField(detail.field)) {
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
    if (router.canGoBack()) router.back();
    else router.replace(`/w/${current.id}/tests`);
  };

  if (!can("tests.manage")) return <Redirect href={`/w/${current.id}/tests`} />;
  if (editing && test.isPending) {
    return (
      <Screen>
        <Spinner label="Loading browser test" />
      </Screen>
    );
  }
  if (editing && test.isError) {
    return (
      <Screen>
        <ErrorState message={itemQueryErrorMessage(test.error)} onRetry={() => void test.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      <View style={styles.stack}>
        <Muted style={styles.intro}>
          {editing
            ? "Update the flow, schedule, and notifications."
            : "Describe a flow for Zenguy to verify in a real browser."}
        </Muted>

        <Card eyebrow="Basics">
          <View style={styles.fields}>
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field error={fieldState.error?.message} label="Name" required>
                  <Input
                    invalid={Boolean(fieldState.error)}
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
              name="startUrl"
              render={({ field, fieldState }) => (
                <Field error={fieldState.error?.message} label="Starting URL" required>
                  <Input
                    autoCapitalize="none"
                    autoComplete="url"
                    autoCorrect={false}
                    inputMode="url"
                    invalid={Boolean(fieldState.error)}
                    keyboardType="url"
                    mono
                    placeholder="https://staging.example.com"
                    textContentType="URL"
                    value={field.value}
                    onBlur={field.onBlur}
                    onChangeText={field.onChange}
                  />
                </Field>
              )}
            />
          </View>
        </Card>

        <Card eyebrow="Instructions">
          <Controller
            control={form.control}
            name="instructions"
            render={({ field, fieldState }) => (
              <Field
                error={fieldState.error?.message}
                hint={instructionsHint}
                label="Steps and expected result"
                required
              >
                <Input
                  invalid={Boolean(fieldState.error)}
                  multiline
                  style={styles.instructions}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                />
              </Field>
            )}
          />
          <View style={styles.warning}>
            <Feather color={colors.warn} name="alert-triangle" size={16} style={styles.warningIcon} />
            <Small color={colors.textBody} style={styles.warningText}>
              {stagingCredentialsCopy}
            </Small>
          </View>
          <Caption style={styles.note}>{tokenNoteCopy}</Caption>
        </Card>

        <Card eyebrow="Device">
          <Controller
            control={form.control}
            name="device"
            render={({ field }) => (
              <View accessibilityRole="radiogroup" style={styles.devices}>
                {deviceOptions.map((option) => {
                  const active = field.value === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      style={({ pressed }) => [
                        styles.device,
                        active && styles.deviceActive,
                        pressed && !active && styles.devicePressed,
                      ]}
                      onPress={() => field.onChange(option.value)}
                    >
                      <IconTile icon={option.icon} tone={active ? "accent" : "plain"} />
                      <Label color={active ? colors.accentInk : colors.textBody} style={styles.deviceLabel}>
                        {option.label}
                      </Label>
                      <View style={[styles.radio, active && styles.radioActive]}>
                        {active ? <View style={styles.radioDot} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
        </Card>

        <Card eyebrow="Schedule">
          <Controller
            control={form.control}
            name="intervalHours"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} hint={timeoutHelpCopy} label="Run frequency" required>
                <SelectSheet
                  invalid={Boolean(fieldState.error)}
                  options={intervalOptions.map((hours) => ({
                    label: intervalOptionLabel(hours),
                    value: hours,
                  }))}
                  title="Run frequency"
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
        </Card>

        <Card eyebrow="Retries">
          <Controller
            control={form.control}
            name="maxRetries"
            render={({ field, fieldState }) => (
              <Field error={fieldState.error?.message} hint={retriesHint} label="Retry failed attempts">
                <SelectSheet
                  invalid={Boolean(fieldState.error)}
                  options={retryOptions.map((retries) => ({
                    label: retryOptionLabel(retries),
                    value: retries,
                  }))}
                  title="Retry failed attempts"
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
        </Card>

        <Controller
          control={form.control}
          name="channelIds"
          render={({ field }) => <ChannelPicker value={field.value} onChange={field.onChange} />}
        />

        <Card eyebrow="Recovery">
          <Controller
            control={form.control}
            name="notifyOnRecovery"
            render={({ field }) => (
              <Toggle
                description="Send a recovery notification after an open incident passes."
                label="Notify when this test recovers"
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        </Card>

        <Card eyebrow="Test it">
          <Body color={colors.textBody}>{runCostCopy}</Body>
          <Caption style={styles.note}>{validationNote}</Caption>
          <Button
            disabled={!form.formState.isValid || validationRunning}
            icon={<Feather color={colors.ink} name="play" size={14} />}
            loading={validation.isPending}
            style={styles.testIt}
            title="Test it"
            onPress={() => void runValidation()}
          />
          {validationRunId ? (
            <>
              <Divider />
              <RunStatusPanel
                compact
                runId={validationRunId}
                wsId={current.id}
                onTerminal={stopValidation}
              />
            </>
          ) : null}
        </Card>

        <FormError message={form.formState.errors.root?.message} />

        <View style={styles.actions}>
          <Button title="Cancel" onPress={cancel} />
          <Button
            loading={form.formState.isSubmitting}
            title={editing ? "Save changes" : "Save test"}
            variant="accent"
            onPress={() => void submit()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
  device: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  deviceActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  deviceLabel: { flex: 1, flexShrink: 1 },
  devicePressed: { backgroundColor: colors.zinc50 },
  devices: { gap: spacing.sm + 2 },
  fields: { gap: spacing.lg },
  instructions: { minHeight: 160 },
  intro: { fontSize: 16, lineHeight: 22 },
  note: { marginTop: spacing.sm },
  radio: {
    alignItems: "center",
    borderColor: colors.borderStrong,
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  radioActive: { borderColor: colors.accent },
  radioDot: { backgroundColor: colors.accent, borderRadius: radius.full, height: 10, width: 10 },
  stack: { gap: spacing.xl },
  testIt: { marginTop: spacing.lg },
  warning: {
    backgroundColor: colors.warnSoft,
    borderColor: palette.amberLine,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  warningIcon: { marginTop: 1 },
  warningText: { flex: 1 },
});
