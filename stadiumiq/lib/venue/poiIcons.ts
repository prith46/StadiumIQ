export type PoiType =
  | "restroom"
  | "restroom_accessible"
  | "water"
  | "food"
  | "first_aid"
  | "atm"
  | "merch"
  | "info"
  | "stairs"
  | "elevator"
  | "exit"
  | "security"
  | "recycling"
  | "qr_beacon";

// 14 hand-authored minimal SVG paths, designed for 24x24 viewBox.
export const POI_ICON_MAP: Record<string, string> = {
  // A clean silhouette of a person (WC)
  restroom: "M12 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm-3.5 5h7a1.5 1.5 0 0 1 1.5 1.5V14a.5.5 0 0 1-.5.5h-1v5.5a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-5.5h-1a.5.5 0 0 1-.5-.5V8.5A1.5 1.5 0 0 1 8.5 7z",
  // Standard accessibility icon (wheelchair)
  restroom_accessible: "M12 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm1.8 4H10v5.6l-2.4 2.4.7.7 2.2-2.2v-4h2.5l2.4 4.8 1.8-.9-3.2-6.4zm-1.8 12c-3.3 0-6-2.7-6-6h-2c0 4.4 3.6 8 8 8s8-3.6 8-8h-2c0 3.3-2.7 6-6 6z",
  // A clean droplet representing water
  water: "M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z",
  // Fork & Knife representing food
  food: "M11 3v6H9V3H7v6c0 2.2 1.8 4 4 4v8h2v-8c2.2 0 4-1.8 4-4V3h-2v6h-2V3h-2z",
  // High contrast plus sign for first aid
  first_aid: "M19 10.5h-5.5V5h-3v5.5H5v3h5.5V19h3v-5.5H19z",
  // Dollar/card icon for ATM
  atm: "M2 6h20v12H2zm4 3h2v2H6zm6 3h6v2h-6z",
  // Shopping bag for merch
  merch: "M6 2L2 8v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-4-6zm6 6a3 3 0 0 1-3-3V4h6v1a3 3 0 0 1-3 3z",
  // Standard info lowercase "i" inside a circle
  info: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z",
  // Stepped staircase outline
  stairs: "M19 3v4h-4v4h-4v4H7v4H3v2h6v-4h4v-4h4V7h4V3z",
  // Elevator box with vertical arrows inside
  elevator: "M19 5v14c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2zM9 10l3-3 3 3H9zm6 4l-3 3-3-3h6z",
  // Standard emergency exit sign (door + arrow)
  exit: "M19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-9 11v-3H3V9h7V6l5 4-5 4z",
  // Clean security shield
  security: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z",
  // Three chasing arrows triangle loop (recycling logo outline)
  recycling: "M2 17h10l-3.5-3.5L10 12l5 5-5 5-1.5-1.5L12 19H2v-2zm12-7H4l3.5 3.5L6 15 1 10l5-5 1.5 1.5L4 8h10V10zm3.5 1.5L19 10l-2-2.5 1.5-1.5L22 11l-5 5-1.5-1.5z",
  // Intersecting target and box lines representing QR beacon
  qr_beacon: "M4 4h6v6H4zm2 2v2h2V6zm8-2h6v6h-6zm2 2v2h2V6zM4 14h6v6H4zm2 2v2h2V16zm10-2h4v2h-4zm2 2h2v4h-2zm-2 2h2v2h-2z",
  
  // Custom Gate & Transit icons
  gate: "M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-2 14H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V8h10v2z",
  train: "M12 2c-4 0-7 .9-7 4v11c0 1.5 1.2 2.7 2.7 2.7l-1.2 1.3h1.5l1.5-1.5h6l1.5 1.5h1.5l-1.2-1.3c1.5 0 2.7-1.2 2.7-2.7V6c0-3.1-3-4-7-4zm5 11H7V7h10v6zm-2 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-5 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z",
  bus: "M4 16c0 .75.22 1.42.59 2H4v2h2v-2h12v2h2v-2h-.59c.37-.58.59-1.25.59-2V6c0-2-2-3-7-3S4 4 4 6v10zm3 1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm10 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM6 6h12v5H6V6z",
  taxi: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  parking: "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-6 11h-3v4H8V6h5c2.2 0 4 1.8 4 4s-1.8 4-4 4zm0-6h-3v4h3c1.1 0 2-.9 2-2s-.9-2-2-2z"
};
