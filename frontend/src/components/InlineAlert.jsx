import { CheckCircle2, CircleAlert, Hourglass } from "lucide-react";

const TONES = {
  danger: { box: "bg-danger-soft", icon: "text-danger", Icon: CircleAlert },
  success: { box: "bg-ok-soft", icon: "text-ok", Icon: CheckCircle2 },
  pending: { box: "bg-warn-soft", icon: "text-warn-text", Icon: Hourglass },
};

export default function InlineAlert({ tone = "danger", children }) {
  const { box, icon, Icon } = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex items-start gap-2 rounded-control px-3 py-2 text-sm ${box}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${icon}`} aria-hidden />
      <div className="min-w-0 text-ink">{children}</div>
    </div>
  );
}
