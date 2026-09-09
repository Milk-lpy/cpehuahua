import { useEffect, useMemo, useRef, useState } from "react";
import type { CpeCell, CpeSnapshot, SmsSummary } from "@cpehuahua/core";
import { loadUiPreferences, saveUiPreferences } from "../live/ui-preferences";
import { H168ControlClient } from "./client";
import type {
  DeviceFeatureState,
  FeatureCapability,
  MaintenanceControlState,
  ManagedClient,
  NetworkControlState,
  SmsMessage,
  WlanControlState,
  WlanSsidState,
} from "./types";

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function ErrorText({ value }: { value: string | null }) {
  return value ? <p className="action-error" role="alert">{value}</p> : null;
}

export function ConfirmDialog({ open, title, detail, confirmLabel, danger = false, onCancel, onConfirm }: {
  open: boolean;
  title: string;
  detail: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return (
    <dialog className="confirm-dialog" ref={ref} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
      <h3>{title}</h3>
      <p>{detail}</p>
      <div>
        <button type="button" className="soft-button" onClick={onCancel}>取消</button>
        <button type="button" className={danger ? "danger-button" : "primary-button"} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

function Toggle({ checked, disabled = false, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange?: (value: boolean) => void;
}) {
  return (
    <button
      className={`switch-button ${checked ? "is-on" : ""}`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
    ><i /></button>
  );
}

function capabilityValue(capability: FeatureCapability | undefined): string {
  if (!capability) return "正在探测设备能力";
  if (capability.value === true) return "当前开启 · 只读";
  if (capability.value === false) return "当前关闭 · 只读";
  if (capability.value !== null) return `设备返回 ${String(capability.value)}`;
  if (capability.status === "unsupported") return "当前固件不支持";
  return "尚未确认";
}

function CapabilityRow({ title, subtitle, capability }: {
  title: string;
  subtitle: string;
  capability: FeatureCapability | undefined;
}) {
  return (
    <div className="control-row control-row--capability">
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
        <em>{capabilityValue(capability)}{capability?.reason ? ` · ${capability.reason}` : ""}</em>
      </div>
      <Toggle checked={capability?.value === true} disabled label={`${title}不可修改`} />
    </div>
  );
}

function bitmask(bands: readonly number[]): string {
  return bands.reduce((mask, band) => mask | (1n << BigInt(band - 1)), 0n).toString(16).toUpperCase();
}

function selectedFromMask(mask: string | null, bands: readonly number[]): number[] {
  if (!mask || !/^[0-9a-f]+$/i.test(mask)) return [];
  const value = BigInt(`0x${mask}`);
  return bands.filter((band) => (value & (1n << BigInt(band - 1))) !== 0n);
}

const LTE_BANDS: readonly number[] = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 42, 43, 71];
const NR_BANDS: readonly number[] = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 71, 77, 78, 79];

export function ControlPage({ client, snapshot }: { client: H168ControlClient; snapshot: CpeSnapshot }) {
  const [state, setState] = useState<NetworkControlState | null>(null);
  const [features, setFeatures] = useState<DeviceFeatureState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingData, setPendingData] = useState<boolean | null>(null);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<"reconnect" | "reboot" | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setState((await client.execute<NetworkControlState>("network.get")).data);
      setFeatures((await client.execute<DeviceFeatureState>("features.get")).data);
    } catch (cause) {
      setError(errorMessage(cause, "控制状态读取失败"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, [client]);

  async function setMobileData(enabled: boolean) {
    setPendingData(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.execute<{ verified: boolean }>("network.mobile-data", { enabled });
      if (!result.data?.verified) throw new Error("设备接受了请求，但移动数据状态回读未确认");
      setNotice(enabled ? "移动数据已开启并回读确认。" : "移动数据已关闭并回读确认。");
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, "移动数据设置失败"));
      setBusy(false);
    }
  }

  async function setNetworkMode(networkMode: string) {
    setPendingMode(null);
    if (!state?.networkBand || !state.lteBand) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (networkMode === "00" && state.lockSupported) await client.execute("network.unlock");
      const result = await client.execute<{ verified: boolean }>("network.set", {
        networkMode,
        networkBand: state.networkBand,
        lteBand: networkMode === "00" ? "7FFFFFFFFFFFFFFF" : state.lteBand,
        ...(state.nrBand ? { nrBand: state.nrBand } : {}),
        ...(state.networkOption ? { networkOption: state.networkOption } : {}),
      });
      if (!result.data?.verified) throw new Error("设备接受了首选网络请求，但回读未确认");
      setNotice(`首选网络已切换为 ${networkMode === "00" ? "自动" : networkMode === "08" ? "5G" : "4G"}。`);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, "首选网络切换失败"));
      setBusy(false);
    }
  }

  async function runConnectionAction(action: "reconnect" | "reboot") {
    setPendingAction(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.execute<{ accepted: boolean; verified: boolean }>(action === "reconnect" ? "network.reconnect" : "device.reboot");
      if (!result.data?.accepted && result.status !== "partial") throw new Error("设备未确认接收请求");
      setNotice(action === "reconnect"
        ? "重连网络请求已发出；蜂窝链路会短暂中断，实时数据恢复后即可确认结果。"
        : "重启设备请求已发出；H168 和 Wi-Fi 会暂时离线，请等待设备恢复。");
    } catch (cause) {
      setError(errorMessage(cause, action === "reconnect" ? "重连网络失败" : "重启设备失败"));
    } finally {
      setBusy(false);
    }
  }

  const supportedModes = state?.supportedModes.length ? state.supportedModes : ["00", "08", "03"];
  return (
    <>
      <section className="soft-panel">
        <div className="section-heading">
          <div><p className="eyebrow">网络控制</p><h2>连接与制式</h2></div>
          <button className="soft-button" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "读取中…" : "刷新"}</button>
        </div>
        <div className="control-grid control-grid--two">
          <div className="control-row">
            <div><strong>移动数据</strong><small>蜂窝网络数据连接</small></div>
            <Toggle checked={state?.mobileData === true} disabled={busy || state?.mobileData === null || !state} label="切换移动数据" onChange={setPendingData} />
          </div>
          <CapabilityRow title="IPv6" subtitle="IPv6 网络协议" capability={features?.ipv6} />
          <CapabilityRow title="NFC 一碰连" subtitle="靠近设备快速连接 WLAN" capability={features?.nfc} />
          <CapabilityRow title="VPN" subtitle="需要设备 VPN 配置" capability={features?.vpn} />
        </div>
        <div className="setting-block">
          <h3>首选方式</h3>
          <div className="segmented segmented--three">
            {["00", "08", "03"].filter((item) => supportedModes.includes(item)).map((item) => (
              <button key={item} type="button" className={state?.networkMode === item ? "is-active" : ""} disabled={busy || !state?.networkBand || !state?.lteBand} onClick={() => setPendingMode(item)}>{item === "00" ? "自动" : item === "08" ? "5G" : "4G"}</button>
            ))}
          </div>
        </div>
        <div className="setting-block">
          <h3>5G 模式</h3>
          <div className="segmented segmented--three is-readonly" aria-label="5G 模式只读">
            {(["SA+NSA", "SA", "NSA"] as const).map((item) => <button key={item} type="button" className={item === snapshot.connection.saNsa ? "is-active" : ""} disabled>{item}</button>)}
          </div>
          <p className="panel-note">当前为 {snapshot.connection.saNsa}（networkOption 原始值 {state?.networkOption ?? "未返回"}）。该值在不同固件映射不同，未取得 H168 写入回读前不开放切换。</p>
        </div>
        {notice && <p className="action-notice">{notice}</p>}
        <ErrorText value={error} />
      </section>

      <section className="soft-panel">
        <div className="section-heading"><div><p className="eyebrow">应用加速</p><h2>终端场景加速</h2></div><Toggle checked={features?.appAcceleration.value === true} disabled label="应用加速不可修改" /></div>
        <div className="inline-selects"><button type="button" disabled>加速场景　游戏</button><button type="button" disabled>选择设备　全部</button></div>
        <div className="empty-state"><span aria-hidden="true">⌁</span><p>{features?.appAcceleration.reason ?? "正在确认 H168 是否提供应用加速接口。"}</p></div>
      </section>

      <section className="soft-panel">
        <div className="section-heading"><div><p className="eyebrow">设备灯效</p><h2>氛围灯</h2></div><Toggle checked={features?.ambientLight.value === true} disabled label="氛围灯不可修改" /></div>
        <div className="color-options" aria-label="设备灯光颜色只读">
          {["冰蓝", "白", "紫", "绿", "梅红", "橙"].map((color, index) => <button key={color} type="button" disabled><i className={`color-dot color-dot--${index}`} />{color}</button>)}
        </div>
        <p className="panel-note">{features?.ambientLight.reason ?? "正在探测设备灯效接口。"}</p>
      </section>

      <section className="soft-panel">
        <div className="section-heading"><div><p className="eyebrow">双链路</p><h2>双宽带 Turbo</h2></div><Toggle checked={features?.dualWanTurbo.value === true} disabled label="双宽带 Turbo 不可修改" /></div>
        <CapabilityRow title="自动切换" subtitle="网络异常时自动切换链路" capability={features?.automaticFailover} />
        <div className="mini-stat-grid"><span><small>宽带速率</small><b>WAN 状态待设备返回</b></span><span><small>SIM 卡速率</small><b>{formatRate(snapshot.network.downloadBps)}</b></span></div>
      </section>

      <section className="soft-panel">
        <div className="section-heading"><div><p className="eyebrow">设备维护</p><h2>即时操作</h2></div></div>
        <div className="maintenance-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => setPendingAction("reconnect")}>重启网络</button><button type="button" className="warning-button" disabled={busy} onClick={() => setPendingAction("reboot")}>重启设备</button></div>
      </section>

      <ConfirmDialog open={pendingData !== null} title={pendingData ? "开启移动数据？" : "关闭移动数据？"} detail={pendingData ? "设备将重新建立蜂窝数据连接。" : "所有终端将立即失去蜂窝互联网，局域网仍可能可用。"} confirmLabel="确认执行" danger={!pendingData} onCancel={() => setPendingData(null)} onConfirm={() => void setMobileData(Boolean(pendingData))} />
      <ConfirmDialog open={pendingMode !== null} title="切换首选网络？" detail="设备会重新选网，蜂窝连接可能短暂中断。" confirmLabel="切换并回读" danger onCancel={() => setPendingMode(null)} onConfirm={() => pendingMode && void setNetworkMode(pendingMode)} />
      <ConfirmDialog open={pendingAction !== null} title={pendingAction === "reboot" ? "确认重启设备？" : "确认重启网络？"} detail={pendingAction === "reboot" ? "H168、Wi-Fi 与实时监控都会暂时断开。" : "只重建蜂窝网络连接，局域网通常保持在线。"} confirmLabel={pendingAction === "reboot" ? "确认重启设备" : "确认重启网络"} danger onCancel={() => setPendingAction(null)} onConfirm={() => pendingAction && void runConnectionAction(pendingAction)} />
    </>
  );
}

export function BandLockPage({ client, snapshot }: { client: H168ControlClient; snapshot: CpeSnapshot }) {
  const [state, setState] = useState<NetworkControlState | null>(null);
  const [mode, setMode] = useState("00");
  const [lte, setLte] = useState<number[]>([]);
  const [nr, setNr] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"apply" | "unlock" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const next = (await client.execute<NetworkControlState>("network.get")).data;
      const allowedLte = next.supportedLteBands?.length ? next.supportedLteBands : LTE_BANDS;
      const allowedNr = next.supportedNrBands?.length ? next.supportedNrBands : NR_BANDS;
      const automatic = next.networkMode === "00" && next.lteLockMode === "0" && next.nrLockMode === "0";
      const lockStateKnown = next.lteLockMode !== null || next.nrLockMode !== null;
      setState(next);
      setMode(next.networkMode ?? "00");
      setLte(automatic ? [] : next.lockedLteBands.length
        ? next.lockedLteBands.filter((band) => allowedLte.includes(band))
        : lockStateKnown ? selectedFromMask(next.lteBand, allowedLte) : []);
      setNr(automatic ? [] : next.lockedNrBands.filter((band) => allowedNr.includes(band)));
    } catch (cause) {
      setError(errorMessage(cause, "锁频状态读取失败"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(); }, [client]);

  function toggle(value: number, values: number[], setValues: (next: number[]) => void) {
    setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function chooseMode(nextMode: string) {
    setMode(nextMode);
    if (nextMode === "00") { setLte([]); setNr([]); }
    else if (nextMode === "03") setNr([]);
    else if (nextMode === "08") setLte([]);
  }

  async function apply(unlock = false) {
    const automatic = unlock || mode === "00";
    if (!state?.networkBand || !state.lockSupported
      || (!automatic && mode === "03" && lte.length === 0)
      || (!automatic && mode === "08" && nr.length === 0)) return;
    setConfirm(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (automatic) {
        const unlocked = await client.execute<{ verified: boolean }>("network.unlock");
        if (!unlocked.data?.verified) throw new Error("设备接受了解锁请求，但回读未确认已解除");
        const auto = await client.execute<{ verified: boolean }>("network.set", {
          networkMode: "00",
          networkBand: state.networkBand,
          lteBand: "7FFFFFFFFFFFFFFF",
          networkOption: state.networkOption ?? "2",
        });
        if (!auto.data?.verified) throw new Error("锁频已解除，但自动选网状态回读未确认");
      } else {
        const network = await client.execute<{ verified: boolean }>("network.set", {
          networkMode: mode,
          networkBand: state.networkBand,
          lteBand: lte.length ? bitmask(lte) : state.lteBand ?? "7FFFFFFFFFFFFFFF",
          networkOption: state.networkOption ?? "2",
        });
        if (!network.data?.verified) throw new Error("设备接受了网络模式请求，但回读未确认");
        const locked = await client.execute<{ verified: boolean }>("network.lock", {
          lteBands: mode === "08" ? [] : lte,
          nrBands: mode === "03" ? [] : nr,
        });
        if (!locked.data?.verified) throw new Error("设备接受了锁频请求，但回读与选择不一致");
      }
      setNotice(automatic ? "已恢复自动选网，所有额外勾选已清除。" : "频段已写入并回读确认，设备正在重新选网。");
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, "锁频失败"));
      setBusy(false);
    }
  }

  const applyingAutomatic = confirm === "unlock" || (confirm === "apply" && mode === "00");
  const servingCells = [snapshot.cells.pcc, ...snapshot.cells.scells].filter((cell): cell is CpeCell => cell !== null);
  const lteNeighbors = snapshot.cells.neighbors.filter((cell) => cell.technology === "LTE");
  const nrNeighbors = snapshot.cells.neighbors.filter((cell) => cell.technology === "NR");
  return (
    <>
      <section className="soft-panel">
        <div className="section-heading"><div><p className="eyebrow">锁频</p><h2>频段选择</h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
        <label className="input-label" htmlFor="network-mode">首选网络</label>
        <select id="network-mode" value={mode} onChange={(event) => chooseMode(event.target.value)}>
          {(state?.supportedModes.length ? state.supportedModes : ["00", "03", "08"]).map((value) => <option key={value} value={value}>{value === "00" ? "自动" : value === "03" ? "4G Only" : value === "08" ? "5G Only" : `模式 ${value}`}</option>)}
        </select>
        {mode === "00" ? (
          <div className="automatic-band-state" role="status"><strong>自动选网</strong><span>自动模式不保留任何 LTE / NR 勾选。</span></div>
        ) : (
          <>
            {mode !== "08" && <BandPicker title="4G 频段" prefix="B" bands={state?.supportedLteBands.length ? state.supportedLteBands : LTE_BANDS} selected={lte} onToggle={(band) => toggle(band, lte, setLte)} />}
            {mode !== "03" && <BandPicker title="5G 频段" prefix="N" bands={state?.supportedNrBands.length ? state.supportedNrBands : NR_BANDS} selected={nr} onToggle={(band) => toggle(band, nr, setNr)} />}
          </>
        )}
        <div className="lock-actions"><button className="soft-button" type="button" disabled={busy || !state?.networkBand || !state.lockSupported} onClick={() => setConfirm("unlock")}>恢复自动</button><button className="primary-button" type="button" disabled={busy || !state?.networkBand || !state.lockSupported || (mode === "03" ? !lte.length : mode === "08" ? !nr.length : false)} onClick={() => setConfirm("apply")}>{busy ? "处理中…" : mode === "00" ? "应用自动模式" : "应用锁频"}</button></div>
        <p className="panel-note">{state?.lockSupported ? "可选频段来自 H168 自身 bandfreqlist；写入后立即回读。" : "设备尚未返回 lock-freq 状态，写入已禁用。"}</p>
        {notice && <p className="action-notice">{notice}</p>}
        <ErrorText value={error} />
      </section>

      <CellSection title="服务载波" eyebrow="PCC / 另外的 SCC" cells={servingCells} serving />
      <CellSection title="4G 邻区" eyebrow="LTE neighbors" cells={lteNeighbors} />
      <CellSection title="5G 邻区" eyebrow="NR neighbors" cells={nrNeighbors} />

      <ConfirmDialog open={confirm !== null} title={applyingAutomatic ? "恢复自动选网？" : "应用新的频段配置？"} detail={applyingAutomatic ? "将清除 LTE / NR 固定频段和所有勾选，蜂窝连接会短暂中断。" : `4G: ${lte.map((band) => `B${band}`).join("+") || "无"}；5G: ${nr.map((band) => `N${band}`).join("+") || "无"}。`} confirmLabel={applyingAutomatic ? "确认恢复自动" : "应用并重新选网"} danger onCancel={() => setConfirm(null)} onConfirm={() => void apply(applyingAutomatic)} />
    </>
  );
}

function BandPicker({ title, prefix, bands, selected, onToggle }: { title: string; prefix: string; bands: readonly number[]; selected: number[]; onToggle: (band: number) => void }) {
  return <fieldset className="band-picker"><legend>{title}<small>可多选</small></legend><div>{bands.map((band) => <label key={band} className={selected.includes(band) ? "is-selected" : ""}><input type="checkbox" checked={selected.includes(band)} onChange={() => onToggle(band)} />{prefix}{band}</label>)}</div></fieldset>;
}

function metricScore(value: number | null, min: number, max: number): { score: number; tone: string } {
  const score = value === null ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return { score, tone: score >= 60 ? "good" : score >= 32 ? "fair" : "poor" };
}

function CellMetric({ label, value, unit, min, max }: { label: string; value: number | null; unit: string; min: number; max: number }) {
  const { score, tone } = metricScore(value, min, max);
  return <span><small>{label}</small><b>{value === null ? "—" : value}<em>{value === null ? "" : unit}</em></b><i><u className={`is-${tone}`} style={{ width: `${score}%` }} /></i></span>;
}

function CellSection({ title, eyebrow, cells, serving = false }: { title: string; eyebrow: string; cells: CpeCell[]; serving?: boolean }) {
  return (
    <section className="soft-panel neighbor-panel">
      <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span className="count-badge">{cells.length}</span></div>
      {cells.length === 0 ? <div className="empty-state"><span aria-hidden="true">⌁</span><p>当前没有设备返回的{title}。</p></div> : <div className="neighbor-list">{cells.map((cell, index) => {
        const role = cell.role === "pcc" ? "PCC" : cell.role === "scell" ? "SCC" : "邻区";
        return <article key={`${cell.role}-${cell.arfcn ?? "x"}-${cell.pci ?? "x"}-${index}`}><div className="neighbor-identity"><strong>{cell.band ?? cell.technology}<em className={cell.role === "scell" ? "is-scc" : ""}>{role}</em></strong><small>{serving ? "服务 ARFCN" : "ARFCN"} {cell.arfcn ?? "—"}</small><small>PCI {cell.pci ?? "—"}{cell.bandwidth ? ` · ${cell.bandwidth}` : ""}</small></div><div className="neighbor-metrics"><CellMetric label="RSRP" value={cell.rsrpDbm} unit="dBm" min={-125} max={-70} /><CellMetric label="RSRQ" value={cell.rsrqDb} unit="dB" min={-25} max={-3} /><CellMetric label="RSSI" value={cell.rssiDbm} unit="dBm" min={-105} max={-45} /><CellMetric label="SINR" value={cell.sinrDb} unit="dB" min={-10} max={30} /></div></article>;
      })}</div>}
    </section>
  );
}

export function MessagesPage({ client, summary }: { client: H168ControlClient; summary: SmsSummary }) {
  const [box, setBox] = useState<1 | 2>(1);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [content, setContent] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [sendConfirm, setSendConfirm] = useState(false);

  async function load(nextBox = box) {
    setBusy(true);
    setError(null);
    try {
      const result = await client.execute<{ messages: SmsMessage[]; count: number }>("sms.list", { box: nextBox, page: 1, count: 50 });
      setMessages(result.data.messages);
      setTotal(result.data.count);
    } catch (cause) {
      setError(errorMessage(cause, "短信读取失败"));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void load(box); }, [client, box]);

  async function markRead(message: SmsMessage) {
    if (!message.unread) return;
    try { await client.execute("sms.read", { index: message.index }); await load(); }
    catch (cause) { setError(errorMessage(cause, "标记已读失败")); }
  }

  async function remove() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    setBusy(true);
    try { await client.execute("sms.delete", { index: id }); await load(); }
    catch (cause) { setError(errorMessage(cause, "删除短信失败")); setBusy(false); }
  }

  async function send() {
    setSendConfirm(false);
    setBusy(true);
    setError(null);
    try {
      await client.execute("sms.send", { phone, content });
      setPhone("");
      setContent("");
      setComposeOpen(false);
      setBox(2);
      await load(2);
    } catch (cause) {
      setError(errorMessage(cause, "短信发送失败"));
      setBusy(false);
    }
  }

  const used = (summary.inbox ?? 0) + (summary.outbox ?? 0) + (summary.draft ?? 0) + (summary.deleted ?? 0);
  const remaining = summary.capacity === null ? null : Math.max(0, summary.capacity - used);
  return (
    <>
      <section className="soft-panel sms-summary-panel"><div className="message-grid"><span><b>{summary.inbox ?? "—"}</b><small>收件箱</small></span><span><b>{summary.outbox ?? "—"}</b><small>发件箱</small></span><span><b>{summary.unread ?? "—"}</b><small>未读</small></span><span><b>{remaining ?? "—"}</b><small>剩余容量</small></span></div></section>
      <section className="soft-panel compose-panel">
        <button className="accordion-heading" type="button" aria-expanded={composeOpen} onClick={() => setComposeOpen((value) => !value)}><strong>发送短信</strong><span>{composeOpen ? "收起" : "展开"}⌄</span></button>
        {composeOpen && <div className="accordion-body"><label className="input-label" htmlFor="sms-phone">收件号码</label><input id="sms-phone" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="手机号" /><label className="input-label" htmlFor="sms-content">短信内容</label><textarea id="sms-content" value={content} maxLength={500} onChange={(event) => setContent(event.target.value)} placeholder="输入短信内容" /><div className="compose-footer"><small>{Array.from(content).length}/500</small><button className="primary-button" type="button" disabled={busy || !/^\+?[0-9]{3,20}$/.test(phone.trim()) || !content.trim()} onClick={() => setSendConfirm(true)}>发送</button></div></div>}
      </section>
      <section className="soft-panel">
        <div className="section-heading"><div><p className="eyebrow">Mailbox</p><h2>短信列表 <span className="inline-count">{total}</span></h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void load()}>刷新</button></div>
        <div className="segmented"><button type="button" className={box === 1 ? "is-active" : ""} onClick={() => setBox(1)}>收件箱</button><button type="button" className={box === 2 ? "is-active" : ""} onClick={() => setBox(2)}>发件箱</button></div>
        {busy && messages.length === 0 ? <p className="loading-line">正在读取设备短信…</p> : messages.length === 0 ? <p className="loading-line">当前邮箱为空</p> : <div className="sms-list">{messages.map((message) => <article key={message.index} className={message.unread ? "is-unread" : ""}><button className="sms-message-button" type="button" onClick={() => void markRead(message)}><span><strong>{message.phone ?? "未知号码"}</strong><time>{message.date ?? "—"}</time></span><p>{message.content ?? "（空短信）"}</p></button><button className="sms-delete-button" type="button" aria-label="删除这条短信" onClick={() => setDeleteId(message.index)}>删除</button></article>)}</div>}
        <p className="loaded-count">已显示 {messages.length}/{total || messages.length} 条 · 加载完成</p>
        <ErrorText value={error} />
      </section>
      <ConfirmDialog open={sendConfirm} title="确认发送短信？" detail={`将向 ${phone} 发送：${content}`} confirmLabel="确认发送" onCancel={() => setSendConfirm(false)} onConfirm={() => void send()} />
      <ConfirmDialog open={deleteId !== null} title="删除这条短信？" detail="删除后无法在设备中恢复。" confirmLabel="确认删除" danger onCancel={() => setDeleteId(null)} onConfirm={() => void remove()} />
    </>
  );
}

function AliasDialog({ client: target, open, initialValue, onCancel, onSave }: { client: ManagedClient | null; open: boolean; initialValue: string; onCancel: () => void; onSave: (value: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initialValue);
  useEffect(() => { setValue(initialValue); }, [initialValue, target]);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return <dialog className="confirm-dialog" ref={ref} onCancel={(event) => { event.preventDefault(); onCancel(); }}><h3>重命名终端</h3><p>别名只保存在当前浏览器；持久化键使用设备 Host ID，不保存 MAC。</p><label className="input-label" htmlFor="client-alias">设备名称</label><input id="client-alias" value={value} maxLength={32} onChange={(event) => setValue(event.target.value)} /><div><button type="button" className="soft-button" onClick={onCancel}>取消</button><button type="button" className="primary-button" disabled={!value.trim()} onClick={() => onSave(value.trim())}>保存</button></div></dialog>;
}

function formatRate(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}Mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}Kbps`;
  return `${value}bps`;
}

function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value >= 1_073_741_824) return `${(value / 1_073_741_824).toFixed(2)}GB`;
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(2)}MB`;
  return `${(value / 1_024).toFixed(1)}KB`;
}

function duration(seconds: number | null): string {
  if (seconds === null) return "离线";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}时${minutes}分`;
}

export function ManagedClients({ client, title = "设备列表" }: { client: H168ControlClient; title?: string }) {
  const [clients, setClients] = useState<ManagedClient[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [block, setBlock] = useState<ManagedClient | null>(null);
  const [filter, setFilter] = useState<"all" | "online">("all");
  const [preferences, setPreferences] = useState(() => loadUiPreferences());
  const [sessionAliases, setSessionAliases] = useState<Record<string, string>>({});
  const [aliasTarget, setAliasTarget] = useState<ManagedClient | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try { setClients((await client.execute<{ clients: ManagedClient[] }>("clients.list")).data.clients); }
    catch (cause) { setError(errorMessage(cause, "终端读取失败")); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [client]);

  async function toggleClient() {
    if (!block?.ssidIndex) return;
    const target = block;
    setBlock(null);
    setBusy(true);
    try {
      const result = await client.execute<{ verified: boolean }>(target.blocked ? "clients.unblock" : "clients.block", {
        macAddress: target.macAddress,
        hostName: target.name ?? target.hostName ?? "Managed device",
        ssidIndex: target.ssidIndex,
      });
      if (!result.data?.verified) throw new Error("设备接受了请求，但过滤名单或总开关回读未确认生效");
      await load();
    } catch (cause) {
      setError(errorMessage(cause, "终端过滤设置失败"));
      setBusy(false);
    }
  }

  function aliasFor(item: ManagedClient): string | null {
    const key = item.id ?? item.macAddress;
    return preferences.clientAliases[key] ?? sessionAliases[key] ?? item.name ?? item.hostName;
  }

  function saveAlias(value: string) {
    if (!aliasTarget) return;
    const key = aliasTarget.id ?? aliasTarget.macAddress;
    setSessionAliases((current) => ({ ...current, [key]: value }));
    if (aliasTarget.id) {
      const next = { ...preferences, clientAliases: { ...preferences.clientAliases, [aliasTarget.id]: value } };
      setPreferences(next);
      saveUiPreferences(next);
    }
    setAliasTarget(null);
  }

  const rows = useMemo(() => filter === "online" ? clients.filter((item) => item.associatedSeconds !== null && !item.blocked) : clients, [clients, filter]);
  return (
    <>
      <section className="soft-panel client-panel">
        <div className="section-heading"><div><p className="eyebrow">Connected devices</p><h2>{title} <span className="inline-count">{clients.length}</span></h2></div><div className="compact-actions"><button className={filter === "all" ? "is-active" : ""} type="button" onClick={() => setFilter("all")}>全部</button><button className={filter === "online" ? "is-active" : ""} type="button" onClick={() => setFilter("online")}>在线</button><button type="button" disabled={busy} onClick={() => void load()}>刷新</button></div></div>
        <div className="managed-clients">{rows.map((item, index) => {
          const totalBytes = item.totalDownloadBytes === null && item.totalUploadBytes === null ? null : (item.totalDownloadBytes ?? 0) + (item.totalUploadBytes ?? 0);
          return <article key={item.macAddress}><div className="client-icon">{item.manufacturer === "Apple" ? "●" : "◆"}</div><div className="client-main"><h3>{aliasFor(item) ?? `终端 ${index + 1}`} <button type="button" onClick={() => setAliasTarget(item)}>重命名</button></h3><p>{item.manufacturer ?? "未知"} · {item.deviceType ?? "设备类型未知"} · {item.frequency ?? "频段未知"} · {item.ssid ?? "SSID 未返回"}</p><small>{item.ipAddress ?? "IP 未返回"}　在线 {duration(item.associatedSeconds)}</small></div><div className="client-telemetry"><span><small>累计接入流量</small><b>{formatBytes(totalBytes)}</b></span><span><small>Wi-Fi 连接速率</small><b>{item.linkRateMbps === null ? "未返回" : `${item.linkRateMbps}Mbps`}</b></span></div><Toggle checked={!item.blocked} disabled={!item.canControl || busy} label={item.blocked ? "恢复终端联网" : "让终端断网"} onChange={() => setBlock(item)} /></article>;
        })}</div>
        {!busy && rows.length === 0 && <p className="loading-line">当前筛选下没有 WLAN 终端</p>}
        <p className="panel-note">断网操作会按终端所在 SSID 修改 H168 黑名单并回读确认；请勿关闭当前用于管理的手机。</p>
        <ErrorText value={error} />
      </section>
      <ConfirmDialog open={block !== null} title={block?.blocked ? "恢复这个终端？" : "让这个终端断网？"} detail={block?.blocked ? `${aliasFor(block) ?? "该终端"} 将从 Wi-Fi 黑名单移除。` : `${block ? aliasFor(block) : "该终端"} 将加入对应 Wi-Fi 黑名单。请确认它不是当前管理设备。`} confirmLabel={block?.blocked ? "确认恢复" : "确认断网"} danger={!block?.blocked} onCancel={() => setBlock(null)} onConfirm={() => void toggleClient()} />
      <AliasDialog client={aliasTarget} open={aliasTarget !== null} initialValue={aliasTarget ? aliasFor(aliasTarget) ?? "" : ""} onCancel={() => setAliasTarget(null)} onSave={saveAlias} />
    </>
  );
}

function primarySsids(state: WlanControlState | null): WlanSsidState[] {
  if (!state) return [];
  const order: WlanSsidState["radio"][] = ["2.4GHz", "5GHz_1", "5GHz_2"];
  return order.flatMap((radio) => state.ssids.find((ssid) => ssid.radio === radio && ssid.guest !== true) ?? []);
}

function WlanPanel({ client, features }: { client: H168ControlClient; features: DeviceFeatureState | null }) {
  const [state, setState] = useState<WlanControlState | null>(null);
  const [openRadio, setOpenRadio] = useState<WlanSsidState["radio"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const value = (await client.execute<WlanControlState>("wlan.get")).data;
      setState(value);
      const active = primarySsids(value).find((ssid) => ssid.enabled)?.radio ?? primarySsids(value)[0]?.radio ?? null;
      setOpenRadio((current) => current ?? active);
    } catch (cause) { setError(errorMessage(cause, "WLAN 状态读取失败")); }
    finally { setBusy(false); }
  }

  useEffect(() => { void load(); }, [client]);
  const ssids = primarySsids(state);
  return (
    <section className="soft-panel wlan-panel">
      <div className="section-heading"><div><p className="eyebrow">WLAN 设置</p><h2>三频无线网络</h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void load()}>{busy ? "读取中…" : "刷新"}</button></div>
      <div className="wlan-accordions">{ssids.map((ssid) => {
        const open = openRadio === ssid.radio;
        return <article key={ssid.index}><button className="accordion-heading" type="button" aria-expanded={open} onClick={() => setOpenRadio(open ? null : ssid.radio)}><strong>{ssid.radio}</strong><span>{open ? "收起" : "展开"}⌄</span></button>{open && <div className="wlan-fields"><div className="control-row"><div><strong>WLAN 开关</strong><small>{ssid.enabled ? "当前开启" : "当前关闭"}</small></div><Toggle checked={ssid.enabled === true} disabled label="WLAN 开关只读" /></div><label>WLAN 名称<input value={ssid.name ?? "设备未返回"} disabled /></label><div className="field-pair"><label>安全模式<input value={ssid.authMode ?? "未返回"} disabled /></label><label>802.11 模式<input value={ssid.wifiMode ?? "未返回"} disabled /></label><label>带宽<input value={ssid.bandwidth ?? "未返回"} disabled /></label><label>信道<input value={ssid.channel ?? "自动 / 未返回"} disabled /></label></div><label>最大接入数<input value={ssid.maxClients ?? "未返回"} disabled /></label><p className="panel-note">{state?.writeReason}</p></div>}</article>;
      })}</div>
      {!busy && ssids.length === 0 && <div className="empty-state"><span aria-hidden="true">⌁</span><p>设备没有返回可解析的三频 WLAN 配置。</p></div>}
      <div className="advanced-wlan"><h3>高级 WLAN</h3><CapabilityRow title="三频优选" subtitle="自动为终端选择 WLAN 频段" capability={features?.triBandOptimization} /><CapabilityRow title="WLAN 频段聚合（MLO）" subtitle="聚合多个频段提升速率与稳定性" capability={features?.mlo} /><CapabilityRow title="WLAN PMF" subtitle="保护管理帧" capability={features?.pmf} /><CapabilityRow title="备用网络" subtitle="为旧设备提供兼容 SSID" capability={features?.backupNetwork} /><div className="field-pair"><label>信号模式<input value="设备未返回" disabled /></label><label>国家/地区<input value="设备未返回" disabled /></label></div></div>
      <ErrorText value={error} />
    </section>
  );
}

export function SettingsPage({ client, rememberPassword, autoLogin, onRememberPasswordChange, onAutoLoginChange, onLogout }: {
  client: H168ControlClient;
  rememberPassword: boolean;
  autoLogin: boolean;
  onRememberPasswordChange: (value: boolean) => void;
  onAutoLoginChange: (value: boolean) => void;
  onLogout: () => void;
}) {
  const [maintenance, setMaintenance] = useState<MaintenanceControlState | null>(null);
  const [features, setFeatures] = useState<DeviceFeatureState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<boolean | null>(null);
  const [pendingAction, setPendingAction] = useState<"reconnect" | "reboot" | "logout" | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      setMaintenance((await client.execute<MaintenanceControlState>("maintenance.get")).data);
      setFeatures((await client.execute<DeviceFeatureState>("features.get")).data);
    } catch (cause) { setError(errorMessage(cause, "设置状态读取失败")); }
    finally { setBusy(false); }
  }

  useEffect(() => { void refresh(); }, [client]);

  async function setAutoUpdate(enabled: boolean) {
    setPendingUpdate(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await client.execute<{ verified: boolean }>("maintenance.auto-update", { enabled });
      if (!result.data?.verified) throw new Error("设备接受了自动升级请求，但回读未确认");
      setNotice(enabled ? "自动升级已开启并回读确认。" : "自动升级已关闭并回读确认。");
      await refresh();
    } catch (cause) { setError(errorMessage(cause, "自动升级设置失败")); setBusy(false); }
  }

  async function runAction(action: "reconnect" | "reboot" | "logout") {
    setPendingAction(null);
    if (action === "logout") { onLogout(); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await client.execute<{ accepted: boolean }>(action === "reconnect" ? "network.reconnect" : "device.reboot");
      if (!result.data?.accepted && result.status !== "partial") throw new Error("设备未确认接收请求");
      setNotice(action === "reconnect" ? "网络重连请求已发出。" : "设备重启请求已发出，请等待 Wi-Fi 恢复。");
    } catch (cause) { setError(errorMessage(cause, action === "reconnect" ? "网络重连失败" : "设备重启失败")); }
    finally { setBusy(false); }
  }

  return (
    <>
      <WlanPanel client={client} features={features} />
      <section className="soft-panel">
        <div className="section-heading"><div><p className="eyebrow">设备维护</p><h2>升级、灯光与重启</h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
        <div className="control-row"><div><strong>自动升级</strong><small>自动安装运营商推送的重要升级</small><em>{maintenance?.autoUpdateSupported ? "设备配置接口可读取，修改后将回读确认" : "当前固件尚未确认此接口"}</em></div><Toggle checked={maintenance?.autoUpdate === true} disabled={busy || !maintenance?.autoUpdateSupported} label="切换自动升级" onChange={setPendingUpdate} /></div>
        <div className="control-row control-row--capability"><div><strong>闲时升级</strong><small>设备空闲时自动下载并升级</small><em>H168 没有返回独立的闲时升级字段</em></div><Toggle checked={maintenance?.uiDownload === true} disabled label="闲时升级不可修改" /></div>
        <CapabilityRow title="信号灯定时关闭" subtitle="夜间关闭设备信号灯" capability={features?.scheduledLedOff ?? maintenance?.ledSchedule} />
        <CapabilityRow title="定时重启" subtitle="按周期在指定时间段重启" capability={features?.scheduledRestart ?? maintenance?.timedRestart} />
        <div className="maintenance-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => setPendingAction("reconnect")}>重启网络</button><button type="button" className="warning-button" disabled={busy} onClick={() => setPendingAction("reboot")}>重启设备</button></div>
        {notice && <p className="action-notice">{notice}</p>}
        <ErrorText value={error} />
      </section>
      <section className="soft-panel support-panel"><div><p className="eyebrow">帮助与支持</p><h2>遇到问题可以联系开发者</h2></div><a className="support-link" href="https://github.com/Milk-lpy/cpehuahua/issues/new" target="_blank" rel="noreferrer"><span><strong>联系支持</strong><small>报告兼容性问题或提交 H168 脱敏证据</small></span><b aria-hidden="true">◎</b></a></section>
      <section className="soft-panel account-panel">
        <div className="section-heading"><div><p className="eyebrow">账号与安全</p><h2>登录设置</h2></div></div>
        <div className="control-row"><div><strong>保存密码</strong><small>下次打开可使用当前管理密码</small></div><Toggle checked={rememberPassword} label="保存密码" onChange={onRememberPasswordChange} /></div>
        <div className="control-row"><div><strong>自动登录</strong><small>打开网页后自动进入实时首页</small></div><Toggle checked={autoLogin} disabled={!rememberPassword} label="自动登录" onChange={onAutoLoginChange} /></div>
        <div className="password-placeholder"><label>修改管理员密码<input value="当前版本暂不开放：H168 要求加密回写" disabled /></label><button type="button" className="soft-button" disabled>下一步</button><button type="button" className="soft-button" disabled>修改密码</button></div>
        <button type="button" className="logout-button" onClick={() => setPendingAction("logout")}>退出登录</button>
      </section>
      <p className="app-version">CPE Huahua Web · 0.1.0</p>
      <ConfirmDialog open={pendingUpdate !== null} title={pendingUpdate ? "开启自动升级？" : "关闭自动升级？"} detail="仅修改设备自动升级开关，并保留当前 ui_download 值；完成后会立即回读。" confirmLabel="确认修改" onCancel={() => setPendingUpdate(null)} onConfirm={() => void setAutoUpdate(Boolean(pendingUpdate))} />
      <ConfirmDialog open={pendingAction !== null} title={pendingAction === "logout" ? "退出登录？" : pendingAction === "reboot" ? "确认重启设备？" : "确认重启网络？"} detail={pendingAction === "logout" ? "会停止实时抓取，并清除 Surge Bridge 中保存的密码和会话。" : pendingAction === "reboot" ? "H168、Wi-Fi 和实时监控会暂时断开。" : "蜂窝连接会短暂中断，局域网通常保持在线。"} confirmLabel={pendingAction === "logout" ? "退出登录" : "确认执行"} danger onCancel={() => setPendingAction(null)} onConfirm={() => pendingAction && void runAction(pendingAction)} />
    </>
  );
}
