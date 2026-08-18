import worker from "./index";

describe("worker scaffold", () => {
  it("returns the scaffold response", async () => {
    const response = worker.fetch();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("zenguy api");
  });
});
