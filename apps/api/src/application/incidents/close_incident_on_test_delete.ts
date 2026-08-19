import type { IncidentCloserOnDelete } from "../browser_tests/incident_closer";
import type {
  IncidentEventRepo,
  IncidentRepo,
} from "../../domain/incidents/repo";
import type { IdGenerator } from "../../shared/ids";

export class CloseIncidentOnTestDelete implements IncidentCloserOnDelete {
  constructor(
    private readonly incidents: Pick<
      IncidentRepo,
      "findOpenForTest" | "resolve"
    >,
    private readonly events: IncidentEventRepo,
    private readonly ids: IdGenerator,
  ) {}

  async closeForTest(input: {
    workspaceId: string;
    testId: string;
    at: number;
  }): Promise<void> {
    const incident = await this.incidents.findOpenForTest(input.testId);
    if (incident === null || incident.workspaceId !== input.workspaceId) return;
    await this.incidents.resolve(incident.id, input.at, {});
    await this.events.insert({
      id: this.ids.newId("evt"),
      incidentId: incident.id,
      type: "TEST_DELETED",
      sourceId: input.testId,
      message: `Browser test ${input.testId} deleted`,
      metadataJson: null,
      createdAt: input.at,
    });
  }
}
