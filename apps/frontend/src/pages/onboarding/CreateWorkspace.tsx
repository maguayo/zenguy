import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";

import { createWorkspace, listWorkspaces } from "../../api/workspaces";
import { AuthShell } from "../../components/AuthShell";
import { Button } from "../../components/ui/Button";
import { ErrorState } from "../../components/ui/ErrorState";
import { Field } from "../../components/ui/Field";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { fieldError } from "../../components/ui/form";
import { useAuth } from "../../contexts/AuthContext";
import { ApiError } from "../../lib/api";
import { apiErrorMessage } from "../../lib/errors";

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Workspace name is required.")
    .max(80, "Workspace name must be 80 characters or fewer."),
  timezone: z.string().min(1, "Choose a timezone."),
});

type CreateWorkspaceValues = z.infer<typeof createWorkspaceSchema>;

export function defaultWorkspaceName(name: string): string {
  const firstName = name.trim().split(/\s+/u)[0];
  return firstName ? `${firstName}'s Workspace` : "My Workspace";
}

export function filterTimezones(timezones: string[], filter: string): string[] {
  const needle = filter.trim().toLocaleLowerCase();
  if (!needle) return timezones;
  return timezones.filter((timezone) => timezone.toLocaleLowerCase().includes(needle));
}

function timezones(): string[] {
  return Intl.supportedValuesOf("timeZone");
}

export default function CreateWorkspace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [timezoneFilter, setTimezoneFilter] = useState("");
  const workspaceQuery = useQuery({ queryFn: listWorkspaces, queryKey: ["workspaces"] });
  const availableTimezones = useMemo(timezones, []);
  const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const form = useForm<CreateWorkspaceValues>({
    defaultValues: {
      name: defaultWorkspaceName(user?.name ?? ""),
      timezone: availableTimezones.includes(localTimezone)
        ? localTimezone
        : availableTimezones[0] ?? "UTC",
    },
    resolver: zodResolver(createWorkspaceSchema),
  });
  const selectedTimezone = form.watch("timezone");
  const filteredTimezones = useMemo(() => {
    const matches = filterTimezones(availableTimezones, timezoneFilter);
    return matches.includes(selectedTimezone)
      ? matches
      : [selectedTimezone, ...matches].filter(Boolean);
  }, [availableTimezones, selectedTimezone, timezoneFilter]);

  const storedWorkspaceId = localStorage.getItem("zenguy:lastWorkspace");
  const backWorkspace =
    workspaceQuery.data?.find((workspace) => workspace.id === storedWorkspaceId) ??
    workspaceQuery.data?.[0];

  const submit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      const workspace = await createWorkspace(values);
      localStorage.setItem("zenguy:lastWorkspace", workspace.id);
      await queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      navigate(`/w/${workspace.id}/overview`, { replace: true });
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
        backWorkspace ? (
          <Link
            className="font-medium text-accent-700 hover:underline"
            to={`/w/${backWorkspace.id}/overview`}
          >
            ← Back to {backWorkspace.name}
          </Link>
        ) : undefined
      }
      title="Create your workspace"
    >
      {workspaceQuery.isError ? (
        <ErrorState
          className="mb-4"
          message="Your existing workspaces couldn't be loaded."
          onRetry={() => void workspaceQuery.refetch()}
        />
      ) : null}
      <form className="space-y-4" noValidate onSubmit={(event) => void submit(event)}>
        <Field
          error={fieldError(form.formState, "name")}
          htmlFor="workspace-name"
          label="Workspace name"
          required
        >
          <Input
            autoComplete="organization"
            id="workspace-name"
            invalid={Boolean(form.formState.errors.name)}
            {...form.register("name")}
          />
        </Field>

        <Field
          error={fieldError(form.formState, "timezone")}
          htmlFor="workspace-timezone"
          label="Timezone"
          required
        >
          <Input
            aria-label="Filter timezones"
            className="mb-2"
            placeholder="Filter timezones"
            type="search"
            value={timezoneFilter}
            onChange={(event) => setTimezoneFilter(event.target.value)}
          />
          <Select
            id="workspace-timezone"
            invalid={Boolean(form.formState.errors.timezone)}
            {...form.register("timezone")}
          >
            {filteredTimezones.map((timezone) => (
              <option key={timezone} value={timezone}>
                {timezone.replaceAll("_", " ")}
              </option>
            ))}
          </Select>
          {filteredTimezones.length <= 1 && timezoneFilter ? (
            <p className="mt-1.5 text-xs text-zinc-500">
              No other timezones match “{timezoneFilter}”.
            </p>
          ) : null}
        </Field>

        {form.formState.errors.root?.message ? (
          <p className="text-sm text-danger-600" role="alert">
            {form.formState.errors.root.message}
          </p>
        ) : null}

        <Button
          className="w-full"
          loading={form.formState.isSubmitting}
          type="submit"
          variant="primary"
        >
          Create workspace
        </Button>
      </form>
    </AuthShell>
  );
}
