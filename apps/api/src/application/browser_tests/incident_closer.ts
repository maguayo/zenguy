export interface IncidentCloserOnDelete {
  closeForTest(input: {
    workspaceId: string;
    testId: string;
    at: number;
  }): Promise<void>;
}

export class NoopIncidentCloserOnDelete implements IncidentCloserOnDelete {
  async closeForTest(_input: {
    workspaceId: string;
    testId: string;
    at: number;
  }): Promise<void> {}
}
