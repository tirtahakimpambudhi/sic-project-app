import { useCallback, useEffect, useRef, useState } from "react";
import { useNotification } from "../context/NotificationContext.jsx";
import { describeSetupResult } from "../utils/setupResult.js";

const RECHECK_MS = 2000; // poll faster than the usual 5 s while a command is outstanding
const SLOW_AFTER_MS = 15000;
const GIVE_UP_MS = 30000;

/**
 * The firmware answers every command on config/status, with no request id. So a command is settled when
 * the device's `setup_reported_at` moves AND `last_operation` matches the operation we sent.
 * (Comparing server timestamps avoids browser/server clock skew.)
 *
 * Usage: call `begin("release")` right BEFORE sending the request (so a fast answer is not missed) and
 * `cancel()` if the request itself fails. The hook then shows a toast with the device's own answer.
 *
 * @param {{ setup_reported_at?: string | null, last_operation?: string, setup_result?: string, setup_detail?: string }} device
 * @param {() => Promise<unknown>} refresh reloads the device data
 */
export default function useCommandFeedback(device, refresh) {
  const { notify } = useNotification();
  const [pending, setPending] = useState(null); // { operation, baseline, startedAt }
  const [slow, setSlow] = useState(false);

  const deviceRef = useRef(device);
  deviceRef.current = device;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  const begin = useCallback((operation) => {
    setSlow(false);
    setPending({ operation, baseline: deviceRef.current.setup_reported_at ?? null, startedAt: Date.now() });
  }, []);

  const cancel = useCallback(() => setPending(null), []);

  // Settled: the board reported the operation we are waiting for.
  useEffect(() => {
    if (!pending) return;
    const moved = (device.setup_reported_at ?? null) !== pending.baseline;
    const sameOperation = !device.last_operation || device.last_operation === pending.operation;
    if (!moved || !sameOperation) return;

    setPending(null);
    const result = describeSetupResult(device.setup_result);
    if (!result) return;
    if (result.kind === "error") {
      notify(device.setup_detail ? `${result.message} ${device.setup_detail}` : result.message, "danger");
    } else {
      notify(result.message, result.kind === "info" ? "info" : "success");
    }
  }, [device, pending, notify]);

  // While waiting: re-check often, flag a slow answer, and eventually give up out loud.
  useEffect(() => {
    if (!pending) return undefined;
    const recheck = setInterval(() => refreshRef.current?.(), RECHECK_MS);
    const flagSlow = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    const giveUp = setTimeout(() => {
      setPending(null);
      notify("Perangkat tidak menjawab. Pastikan perangkat online dan terhubung ke broker, lalu coba lagi.", "danger");
    }, GIVE_UP_MS);
    return () => {
      clearInterval(recheck);
      clearTimeout(flagSlow);
      clearTimeout(giveUp);
    };
  }, [pending, notify]);

  return { pending, slow, begin, cancel };
}
