import { ScreenshotViewer } from "@zenguy/frontend";

const EXPIRES = "2024-05-16T12:00:00.000Z";

function shotUrl(label: string, accent: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">` +
    `<rect width="1280" height="800" fill="#fafafa"/>` +
    `<rect width="1280" height="56" fill="#18181b"/>` +
    `<circle cx="26" cy="28" r="6" fill="#3f3f46"/><circle cx="48" cy="28" r="6" fill="#3f3f46"/><circle cx="70" cy="28" r="6" fill="#3f3f46"/>` +
    `<rect x="100" y="16" width="420" height="24" rx="12" fill="#27272a"/>` +
    `<text x="116" y="33" font-family="Arial" font-size="14" fill="#a1a1aa">aurora-plants.com/checkout</text>` +
    `<rect x="80" y="120" width="720" height="14" rx="7" fill="#e4e4e7"/>` +
    `<rect x="80" y="156" width="540" height="14" rx="7" fill="#e4e4e7"/>` +
    `<rect x="80" y="230" width="260" height="56" rx="10" fill="${accent}"/>` +
    `<text x="106" y="265" font-family="Arial" font-size="18" fill="#ffffff">Complete purchase</text>` +
    `<text x="80" y="420" font-family="Arial" font-size="34" fill="#3f3f46">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const screenshots = [
  {
    caption: "Add “Monstera XL” to the cart",
    expiresAt: EXPIRES,
    id: "shot_01",
    url: shotUrl("Product — Monstera XL", "#4f46e5"),
  },
  {
    caption: "Pay with the 4242 test card",
    expiresAt: EXPIRES,
    id: "shot_02",
    url: shotUrl("Checkout — payment details", "#4f46e5"),
  },
  {
    caption: "Order confirmation is shown",
    expiresAt: EXPIRES,
    id: "shot_03",
    url: shotUrl("Order #AP-10382 confirmed", "#059669"),
  },
];

export const EvidenceViewer = () => (
  <ScreenshotViewer
    initialIndex={1}
    open
    screenshots={screenshots}
    onClose={() => {}}
  />
);

export const ExpiredEvidence = () => (
  <ScreenshotViewer
    initialIndex={0}
    open
    screenshots={[
      {
        caption: "Add “Monstera XL” to the cart",
        expiresAt: "2024-05-14T12:00:00.000Z",
        id: "shot_11",
        url: "https://artifacts.zenguy.invalid/shot_11.png",
      },
    ]}
    onClose={() => {}}
  />
);
