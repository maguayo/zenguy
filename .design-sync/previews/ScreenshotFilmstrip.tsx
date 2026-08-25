import { ScreenshotFilmstrip } from "@zenguy/frontend";

const EXPIRES = "2024-05-16T12:00:00.000Z";

function shotUrl(label: string, accent: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420">` +
    `<rect width="640" height="420" fill="#fafafa"/>` +
    `<rect width="640" height="44" fill="#18181b"/>` +
    `<circle cx="22" cy="22" r="5" fill="#3f3f46"/><circle cx="40" cy="22" r="5" fill="#3f3f46"/><circle cx="58" cy="22" r="5" fill="#3f3f46"/>` +
    `<rect x="84" y="12" width="300" height="20" rx="10" fill="#27272a"/>` +
    `<text x="98" y="26" font-family="Arial" font-size="12" fill="#a1a1aa">aurora-plants.com</text>` +
    `<rect x="40" y="90" width="560" height="10" rx="5" fill="#e4e4e7"/>` +
    `<rect x="40" y="118" width="420" height="10" rx="5" fill="#e4e4e7"/>` +
    `<rect x="40" y="170" width="180" height="44" rx="8" fill="${accent}"/>` +
    `<text x="40" y="280" font-family="Arial" font-size="24" fill="#3f3f46">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const items = [
  {
    caption: "Open aurora-plants.com",
    expiresAt: EXPIRES,
    id: "shot_01",
    label: "Step 1 · goto",
    sequence: 1,
    url: shotUrl("Home — Aurora Plants", "#4f46e5"),
  },
  {
    caption: "Add “Monstera XL” to the cart",
    expiresAt: EXPIRES,
    id: "shot_02",
    label: "Step 2 · click",
    sequence: 2,
    url: shotUrl("Product — Monstera XL", "#4f46e5"),
  },
  {
    caption: "Pay with the 4242 test card",
    expiresAt: EXPIRES,
    id: "shot_03",
    label: "Step 3 · fill",
    sequence: 3,
    url: shotUrl("Checkout — payment", "#4f46e5"),
  },
  {
    caption: "Order confirmation is shown",
    expiresAt: EXPIRES,
    id: "shot_04",
    label: "Step 4 · done",
    sequence: 4,
    url: shotUrl("Order #AP-10382 confirmed", "#059669"),
  },
];

export const CheckoutSteps = () => (
  <div style={{ width: 780 }}>
    <ScreenshotFilmstrip items={items} onOpen={() => {}} />
  </div>
);

const withExpired = [
  items[0],
  {
    caption: "Add “Monstera XL” to the cart",
    expiresAt: "2024-05-14T12:00:00.000Z",
    id: "shot_12",
    label: "Step 2 · click",
    sequence: 2,
    url: "https://artifacts.zenguy.invalid/shot_12.png",
  },
  items[3],
];

export const WithExpiredScreenshot = () => (
  <div style={{ width: 780 }}>
    <ScreenshotFilmstrip items={withExpired} onOpen={() => {}} />
  </div>
);
