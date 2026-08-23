import { isAdminEmail, parseAdminEmails } from "./allowlist";

it("normalises the comma separated allowlist", () => {
  expect([...parseAdminEmails(" Marcos@Aguayo.es ,ops@example.com,, ")]).toEqual([
    "marcos@aguayo.es",
    "ops@example.com",
  ]);
  expect(isAdminEmail("marcos@aguayo.es", "MARCOS@aguayo.es")).toBe(true);
  expect(isAdminEmail("marcos@aguayo.es", "other@aguayo.es")).toBe(false);
  expect(isAdminEmail("", "marcos@aguayo.es")).toBe(false);
});
