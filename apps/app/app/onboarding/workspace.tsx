import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, View } from "react-native";

import type { User } from "@/api/types";
import { createWorkspace, listWorkspaces } from "@/api/workspaces";
import {
  backWorkspace,
  createWorkspaceSchema,
  defaultTimezone,
  defaultWorkspaceName,
  type CreateWorkspaceValues,
} from "@/components/auth/create-workspace";
import { AuthShell } from "@/components/AuthShell";
import { FormError } from "@/components/FormError";
import { TimezonePicker } from "@/components/TimezonePicker";
import { useAuth } from "@/contexts/AuthContext";
import {
  lastWorkspaceId,
  rememberWorkspace,
} from "@/contexts/WorkspaceContext";
import { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/errors";
import { availableTimezones, localTimezone } from "@/lib/timezones";
import { colors, spacing } from "@/theme";
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Label,
  Screen,
  Spinner,
} from "@/ui";

function CreateWorkspaceForm({ user }: { user: User }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [lastId, setLastId] = useState<string | null>(null);
  const workspaceQuery = useQuery({
    queryFn: listWorkspaces,
    queryKey: ["workspaces"],
  });
  const form = useForm<CreateWorkspaceValues>({
    defaultValues: {
      name: defaultWorkspaceName(user.name),
      timezone: defaultTimezone(availableTimezones(), localTimezone()),
    },
    resolver: zodResolver(createWorkspaceSchema),
  });

  useEffect(() => {
    let active = true;
    void lastWorkspaceId().then((value) => {
      if (active) setLastId(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const back = backWorkspace(workspaceQuery.data, lastId);

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const workspace = await createWorkspace(values);
      // The workspace exists now; a Keychain hiccup must not make it look failed.
      await rememberWorkspace(workspace.id).catch(() => undefined);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      router.replace(`/w/${workspace.id}/overview`);
    } catch (error) {
      if (error instanceof ApiError && error.details?.length) {
        let handled = false;
        for (const detail of error.details) {
          if (detail.field === "name" || detail.field === "timezone") {
            form.setError(detail.field, { message: detail.message });
            handled = true;
          }
        }
        if (handled) return;
      }
      form.setError("root", { message: apiErrorMessage(error) });
    }
  });

  return (
    <AuthShell
      description="Set the name and timezone your team will use. Free access starts immediately — no card required."
      footer={
        back ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.replace(`/w/${back.id}/overview`)}
          >
            <Label color={colors.accentDark}>← Back to {back.name}</Label>
          </Pressable>
        ) : undefined
      }
      title="Create your workspace"
    >
      <Card elevated padding="lg">
        <View style={styles.form}>
          {workspaceQuery.isError ? (
            <ErrorState
              message="Your existing workspaces couldn't be loaded."
              onRetry={() => void workspaceQuery.refetch()}
            />
          ) : null}
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Field
                error={fieldState.error?.message}
                label="Workspace name"
                required
              >
                <Input
                  autoCapitalize="words"
                  autoComplete="organization"
                  invalid={Boolean(fieldState.error)}
                  returnKeyType="done"
                  textContentType="organizationName"
                  value={field.value}
                  onBlur={field.onBlur}
                  onChangeText={field.onChange}
                  onSubmitEditing={() => void submit()}
                />
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="timezone"
            render={({ field, fieldState }) => (
              <Field
                error={fieldState.error?.message}
                label="Timezone"
                required
              >
                <TimezonePicker
                  invalid={Boolean(fieldState.error)}
                  value={field.value}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />
          <FormError message={form.formState.errors.root?.message} />
          <Button
            fullWidth
            loading={form.formState.isSubmitting}
            size="lg"
            title="Create workspace"
            variant="accent"
            onPress={() => void submit()}
          />
        </View>
      </Card>
    </AuthShell>
  );
}

/** First workspace after sign-up, or an extra one; needs a verified session. */
export default function CreateWorkspaceScreen() {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <Screen safe={["top", "bottom"]} scroll={false}>
        <Spinner label="Loading Zenguy" size="large" style={styles.fill} />
      </Screen>
    );
  }
  if (status !== "signedIn" || !user)
    return <Redirect href="/(auth)/sign-in" />;
  if (!user.emailVerified) return <Redirect href="/verify-pending" />;
  return <CreateWorkspaceForm user={user} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: { gap: spacing.lg },
});
