import { describeSetupResult } from "../utils/setupResult.js";
import { timeAgo } from "../utils/format.js";
import InlineAlert from "./InlineAlert.jsx";

const TONE = { success: "success", info: "info", error: "danger" };

/**
 * Shows what the board itself said about the last command (config/status).
 * `feedback` is the object from useCommandFeedback ({ pending, slow }); while `pending` is set the board
 * has not answered yet.
 */
export default function CommandResult({ device, feedback }) {
  if (feedback?.pending) {
    return (
      <InlineAlert tone="pending">
        {feedback.slow
          ? "Perangkat belum menjawab. Pastikan perangkat online dan terhubung ke broker."
          : "Perintah terkirim. Menunggu konfirmasi dari perangkat…"}
      </InlineAlert>
    );
  }
  const result = describeSetupResult(device.setup_result);
  if (!result) {
    return (
      <p className="text-sm text-muted">
        Belum ada laporan dari perangkat ini. Laporan baru muncul setelah perangkat tersambung atau menjalankan sebuah perintah.
      </p>
    );
  }
  return (
    <InlineAlert tone={TONE[result.kind]}>
      <p className="font-medium">{result.message}</p>
      {device.setup_detail && <p className="mt-0.5 break-words text-[13px] text-muted">{device.setup_detail}</p>}
      <p className="mt-0.5 text-[12px] text-muted">
        Operasi “{device.last_operation}” · dilaporkan {timeAgo(device.setup_reported_at)}
      </p>
    </InlineAlert>
  );
}
