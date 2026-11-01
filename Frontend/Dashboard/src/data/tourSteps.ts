// MVP product tour.
// Every target must exist in the currently supported dashboard UI.

export interface TourStep {
  target: string;
  title: string;
  body: string;
  placement?: "auto" | "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "sidebar",
    title: "Your Revluma workspaces",
    body: "Use Command Center to understand your store, Rev Intelligence to investigate findings, and Integrations to manage your Shopify connection.",
    placement: "right",
  },
  {
    target: "topbar-breadcrumb",
    title: "Know where you are",
    body: "This breadcrumb identifies your current workspace as you navigate Revluma.",
    placement: "bottom",
  },
  {
    target: "topbar-rev",
    title: "Investigate with Rev",
    body: "Open Rev Intelligence to ask questions about available store information and investigate supported findings.",
    placement: "bottom",
  },
  {
    target: "topbar-notif",
    title: "Notifications",
    body: "Open notifications to check available updates. The indicator appears when unread notifications are reported.",
    placement: "bottom",
  },
];
