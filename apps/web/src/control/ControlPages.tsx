import { useEffect, useMemo, useRef, useState } from "react";
import type { CpeSnapshot } from "@cpehuahua/core";
import { H168ControlClient } from "./client";
import type { ManagedClient, NetworkControlState, SmsMessage } from "./types";

function ErrorText({ value }: { value: string | null }) {
  return value ? <p className="action-error" role="alert">{value}</p> : null;
}

function ConfirmDialog({ open, title, detail, confirmLabel, danger = false, onCancel, onConfirm }: {
  open: boolean; title: string; detail: string; confirmLabel: string; danger?: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return <dialog className="confirm-dialog" ref={ref} onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h3>{title}</h3><p>{detail}</p><div><button type="button" className="soft-button" onClick={onCancel}>取消</button><button type="button" className={danger ? "danger-button" : "primary-button"} onClick={onConfirm}>{confirmLabel}</button></div>
  </dialog>;
}

function bitmask(bands: readonly number[]): string {
  return bands.reduce((mask, band) => mask | (1n << BigInt(band - 1)), 0n).toString(16).toUpperCase();
}

function selectedFromMask(mask: string | null, bands: readonly number[]): number[] {
  if (!mask || !/^[0-9a-f]+$/i.test(mask)) return [];
  const value = BigInt(`0x${mask}`);
  return bands.filter((band) => (value & (1n << BigInt(band - 1))) !== 0n);
}

const LTE_BANDS = [1, 3, 5, 7, 8, 20, 28, 32, 38, 40, 41, 42, 43, 71] as const;
const NR_BANDS = [1, 3, 5, 7, 8, 20, 28, 38, 40, 41, 71, 77, 78, 79] as const;

export function ControlPage({ client }: { client: H168ControlClient }) {
  const [state, setState] = useState<NetworkControlState | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [pendingData, setPendingData] = useState<boolean | null>(null), [reboot, setReboot] = useState(false);

  async function refresh() {
    setBusy(true); setError(null);
    try { setState((await client.execute<NetworkControlState>("network.get")).data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "控制状态读取失败"); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [client]);

  async function setMobileData(enabled: boolean) {
    setPendingData(null); setBusy(true); setError(null); setNotice(null);
    try { const result = await client.execute<{ verified: boolean }>("network.mobile-data", { enabled }); if (!result.data?.verified) throw new Error("设备接受了请求，但移动数据状态回读未确认"); setNotice(enabled ? "移动数据已开启" : "移动数据已关闭"); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "移动数据设置失败"); setBusy(false); }
  }
  async function doReboot() {
    setReboot(false); setBusy(true); setError(null);
    try { await client.execute("device.reboot"); setNotice("重启命令已发送，设备和实时连接会暂时离线。" ); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "重启失败"); }
    finally { setBusy(false); }
  }
  return <>
    <section className="soft-panel"><div className="section-heading"><div><p className="eyebrow">Connection control</p><h2>网络与设备</h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "读取中…" : "刷新"}</button></div>
      <div className="control-row"><div><strong>移动数据</strong><small>{state?.mobileData === null || state === null ? "设备状态未确认" : state.mobileData ? "当前开启" : "当前关闭"}</small></div><button className={`switch-button ${state?.mobileData ? "is-on" : ""}`} type="button" disabled={busy || state?.mobileData === null || state === null} aria-label={state?.mobileData ? "关闭移动数据" : "开启移动数据"} onClick={() => setPendingData(!state?.mobileData)}><i /></button></div>
      <div className="control-row"><div><strong>重启 H168</strong><small>会中断蜂窝和 Wi-Fi 数分钟</small></div><button className="danger-soft-button" type="button" disabled={busy} onClick={() => setReboot(true)}>重启</button></div>
      {notice && <p className="action-notice">{notice}</p>}<ErrorText value={error} />
    </section>
    <section className="soft-panel"><p className="eyebrow">Capability boundary</p><h2>其他设备控制</h2><div className="capability-list"><span><b>Wi-Fi 名称与密码</b><em>待读取 H168 WLAN 配置后开放</em></span><span><b>定时重启 / 升级</b><em>高风险，尚未通过本机回读验证</em></span><span><b>恢复出厂 / 关机</b><em>不提供未经验证的快捷操作</em></span></div></section>
    <ConfirmDialog open={pendingData !== null} title={pendingData ? "开启移动数据？" : "关闭移动数据？"} detail={pendingData ? "设备将重新建立蜂窝数据连接。" : "所有终端将立即失去蜂窝互联网，局域网仍可能可用。"} confirmLabel="确认执行" danger={!pendingData} onCancel={() => setPendingData(null)} onConfirm={() => void setMobileData(Boolean(pendingData))} />
    <ConfirmDialog open={reboot} title="确认重启设备？" detail="H168、Wi-Fi 与实时监控都会暂时断开。请等待设备恢复后重新启动实时监控。" confirmLabel="确认重启" danger onCancel={() => setReboot(false)} onConfirm={() => void doReboot()} />
  </>;
}

export function BandLockPage({ client, snapshot }: { client: H168ControlClient; snapshot: CpeSnapshot }) {
  const [state, setState] = useState<NetworkControlState | null>(null), [mode, setMode] = useState("00");
  const [lte, setLte] = useState<number[]>([]), [nr, setNr] = useState<number[]>([]), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState<"apply" | "unlock" | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  async function refresh() { setBusy(true); setError(null); try { const next = (await client.execute<NetworkControlState>("network.get")).data; setState(next); setMode(next.networkMode ?? "00"); setLte(next.lockedLteBands.length > 0 ? next.lockedLteBands : selectedFromMask(next.lteBand, LTE_BANDS)); setNr(next.lockedNrBands); } catch (cause) { setError(cause instanceof Error ? cause.message : "锁频状态读取失败"); } finally { setBusy(false); } }
  useEffect(() => { void refresh(); }, [client]);
  const toggle = (value: number, values: number[], setValues: (next: number[]) => void) => setValues(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  async function apply(unlock = false) { if (!state?.networkBand || !state.lockSupported || (!unlock && mode === "03" && lte.length === 0) || (!unlock && mode === "08" && nr.length === 0) || (!unlock && mode === "00" && lte.length === 0 && nr.length === 0)) return; setConfirm(null); setBusy(true); setError(null); setNotice(null); try { if (unlock) { const unlocked = await client.execute<{ verified: boolean }>("network.unlock"); if (!unlocked.data?.verified) throw new Error("设备接受了解锁请求，但回读未确认已解除"); const auto = await client.execute<{ verified: boolean }>("network.set", { networkMode: "00", networkBand: state.networkBand, lteBand: "7FFFFFFFFFFFFFFF", networkOption: state.networkOption ?? "2" }); if (!auto.data?.verified) throw new Error("锁频已解除，但自动选网状态回读未确认"); } else { const selectedLteMask = lte.length > 0 ? bitmask(lte) : state.lteBand ?? "7FFFFFFFFFFFFFFF"; const network = await client.execute<{ verified: boolean }>("network.set", { networkMode: mode, networkBand: state.networkBand, lteBand: selectedLteMask, networkOption: state.networkOption ?? "2" }); if (!network.data?.verified) throw new Error("设备接受了网络模式请求，但回读未确认"); const locked = await client.execute<{ verified: boolean }>("network.lock", { lteBands: mode === "08" ? [] : lte, nrBands: mode === "03" ? [] : nr }); if (!locked.data?.verified) throw new Error("设备接受了锁频请求，但回读与选择不一致"); } setNotice(unlock ? "已恢复自动选网并解除 LTE / NR 锁频。" : "频段配置已提交并回读；设备正在重新选网。" ); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "锁频失败"); setBusy(false); } }
  return <>
    <section className="soft-panel"><div className="section-heading"><div><p className="eyebrow">Current radio</p><h2>当前服务小区</h2></div><span className="count-badge">{snapshot.connection.radioMode} {snapshot.connection.saNsa}</span></div><div className="lock-current"><strong>{snapshot.radio.band ?? "频段未返回"}</strong><span>ARFCN {snapshot.radio.arfcn ?? "—"} · PCI {snapshot.radio.pci ?? "—"}</span></div></section>
    <section className="soft-panel"><div className="section-heading"><div><p className="eyebrow">Band lock</p><h2>自定义锁频</h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void refresh()}>刷新</button></div>
      <label className="input-label" htmlFor="network-mode">首选网络</label><select id="network-mode" value={mode} onChange={(event) => setMode(event.target.value)}>{(state?.supportedModes.length ? state.supportedModes : ["00", "03", "08"]).map((value) => <option key={value} value={value}>{value === "00" ? "自动" : value === "03" ? "4G Only" : value === "08" ? "5G Only" : `模式 ${value}`}</option>)}</select>
      {mode !== "08" && <BandPicker title="4G 频段" prefix="B" bands={state?.supportedLteBands.length ? state.supportedLteBands : LTE_BANDS} selected={lte} onToggle={(band) => toggle(band, lte, setLte)} />}
      {mode !== "03" && <BandPicker title="5G 频段" prefix="N" bands={NR_BANDS} selected={nr} onToggle={(band) => toggle(band, nr, setNr)} />}
      <div className="lock-actions"><button className="soft-button" type="button" disabled={busy || !state?.networkBand || !state.lockSupported} onClick={() => setConfirm("unlock")}>恢复自动</button><button className="primary-button" type="button" disabled={busy || !state?.networkBand || !state.lockSupported || (mode === "03" ? lte.length === 0 : mode === "08" ? nr.length === 0 : lte.length === 0 && nr.length === 0)} onClick={() => setConfirm("apply")}>{busy ? "处理中…" : "应用锁频"}</button></div>
      <p className="panel-note">{state?.lockSupported ? "使用 H168 的 lock-freq 配置 LTE / NR Band，并在写入后回读确认。" : "当前设备尚未返回 lock-freq 状态，写入已禁用；请先在探针页重新采集。"}</p>{notice && <p className="action-notice">{notice}</p>}<ErrorText value={error} />
    </section>
    <ConfirmDialog open={confirm !== null} title={confirm === "unlock" ? "恢复自动选网？" : "应用新的频段配置？"} detail={confirm === "unlock" ? "将恢复自动模式和参考全频段掩码，蜂窝连接会短暂中断。" : `4G: ${lte.map((b) => `B${b}`).join("+") || "无"}；5G: ${nr.map((b) => `N${b}`).join("+") || "无"}。蜂窝连接会短暂中断。`} confirmLabel={confirm === "unlock" ? "确认恢复自动" : "应用并重新选网"} danger onCancel={() => setConfirm(null)} onConfirm={() => void apply(confirm === "unlock")} />
  </>;
}

function BandPicker({ title, prefix, bands, selected, onToggle }: { title: string; prefix: string; bands: readonly number[]; selected: number[]; onToggle: (band: number) => void }) {
  return <fieldset className="band-picker"><legend>{title}<small>可多选</small></legend><div>{bands.map((band) => <label key={band} className={selected.includes(band) ? "is-selected" : ""}><input type="checkbox" checked={selected.includes(band)} onChange={() => onToggle(band)} />{prefix}{band}</label>)}</div></fieldset>;
}

export function MessagesPage({ client }: { client: H168ControlClient }) {
  const [box, setBox] = useState<1 | 2>(1), [messages, setMessages] = useState<SmsMessage[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState(""), [content, setContent] = useState(""), [deleteId, setDeleteId] = useState<string | null>(null), [sendConfirm, setSendConfirm] = useState(false);
  async function load(nextBox = box) { setBusy(true); setError(null); try { const result = await client.execute<{ messages: SmsMessage[] }>("sms.list", { box: nextBox, page: 1, count: 50 }); setMessages(result.data.messages); } catch (cause) { setError(cause instanceof Error ? cause.message : "短信读取失败"); } finally { setBusy(false); } }
  useEffect(() => { void load(box); }, [client, box]);
  async function markRead(message: SmsMessage) { if (!message.unread) return; try { await client.execute("sms.read", { index: message.index }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "标记已读失败"); } }
  async function remove() { if (!deleteId) return; const id = deleteId; setDeleteId(null); setBusy(true); try { await client.execute("sms.delete", { index: id }); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "删除短信失败"); setBusy(false); } }
  async function send() { setSendConfirm(false); setBusy(true); try { await client.execute("sms.send", { phone, content }); setPhone(""); setContent(""); setBox(2); await load(2); } catch (cause) { setError(cause instanceof Error ? cause.message : "短信发送失败"); setBusy(false); } }
  return <>
    <section className="soft-panel"><div className="section-heading"><div><p className="eyebrow">Compose</p><h2>发送短信</h2></div></div><label className="input-label" htmlFor="sms-phone">收件号码</label><input id="sms-phone" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="手机号" /><label className="input-label" htmlFor="sms-content">短信内容</label><textarea id="sms-content" value={content} maxLength={500} onChange={(event) => setContent(event.target.value)} placeholder="输入短信内容" /><div className="compose-footer"><small>{Array.from(content).length}/500</small><button className="primary-button" type="button" disabled={busy || !/^\+?[0-9]{3,20}$/.test(phone.trim()) || !content.trim()} onClick={() => setSendConfirm(true)}>发送</button></div></section>
    <section className="soft-panel"><div className="section-heading"><div><p className="eyebrow">Mailbox</p><h2>短信列表</h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void load()}>刷新</button></div><div className="segmented"><button type="button" className={box === 1 ? "is-active" : ""} onClick={() => setBox(1)}>收件箱</button><button type="button" className={box === 2 ? "is-active" : ""} onClick={() => setBox(2)}>发件箱</button></div>{busy && messages.length === 0 ? <p className="loading-line">正在读取设备短信…</p> : messages.length === 0 ? <p className="loading-line">当前邮箱为空</p> : <div className="sms-list">{messages.map((message) => <article key={message.index} className={message.unread ? "is-unread" : ""} onClick={() => void markRead(message)}><div><strong>{message.phone ?? "未知号码"}</strong><time>{message.date ?? "—"}</time></div><p>{message.content ?? "（空短信）"}</p><button type="button" aria-label="删除这条短信" onClick={(event) => { event.stopPropagation(); setDeleteId(message.index); }}>删除</button></article>)}</div>}<ErrorText value={error} /></section>
    <ConfirmDialog open={sendConfirm} title="确认发送短信？" detail={`将向 ${phone} 发送：${content}`} confirmLabel="确认发送" onCancel={() => setSendConfirm(false)} onConfirm={() => void send()} />
    <ConfirmDialog open={deleteId !== null} title="删除这条短信？" detail="删除后无法在设备中恢复。" confirmLabel="确认删除" danger onCancel={() => setDeleteId(null)} onConfirm={() => void remove()} />
  </>;
}

export function ManagedClients({ client }: { client: H168ControlClient }) {
  const [clients, setClients] = useState<ManagedClient[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [block, setBlock] = useState<ManagedClient | null>(null);
  async function load() { setBusy(true); setError(null); try { setClients((await client.execute<{ clients: ManagedClient[] }>("clients.list")).data.clients); } catch (cause) { setError(cause instanceof Error ? cause.message : "终端读取失败"); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, [client]);
  async function toggleClient() { if (!block?.ssidIndex) return; const target = block; setBlock(null); setBusy(true); try { const result = await client.execute<{ verified: boolean }>(target.blocked ? "clients.unblock" : "clients.block", { macAddress: target.macAddress, hostName: target.name ?? target.hostName ?? "Managed device", ssidIndex: target.ssidIndex }); if (!result.data?.verified) throw new Error("设备接受了请求，但过滤名单或总开关回读未确认生效"); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "终端过滤设置失败"); setBusy(false); } }
  const rows = useMemo(() => clients, [clients]);
  return <><section className="soft-panel"><div className="section-heading"><div><p className="eyebrow">Connected devices</p><h2>终端管理</h2></div><button className="soft-button" type="button" disabled={busy} onClick={() => void load()}>刷新</button></div><div className="managed-clients">{rows.map((item, index) => <article key={item.macAddress}><div className="client-icon">{item.manufacturer === "Apple" ? "●" : "◆"}</div><div><h3>{item.name ?? item.hostName ?? `终端 ${index + 1}`}</h3><p>{item.ipAddress ?? "IP 未返回"} · {item.frequency ?? "频段未知"}</p><small>{item.blocked ? "已加入黑名单" : item.macAddress}</small></div><button className={item.blocked ? "soft-button" : "danger-soft-button"} type="button" disabled={!item.canControl} onClick={() => setBlock(item)}>{item.blocked ? "恢复" : "断网"}</button></article>)}</div>{!busy && rows.length === 0 && <p className="loading-line">当前没有在线 WLAN 终端</p>}<p className="panel-note">按终端所在 SSID 读改写回 H168 多网络黑名单；无法确认 SSID 索引时按钮会自动禁用。请勿断开当前用于管理设备的 iPhone。</p><ErrorText value={error} /></section><ConfirmDialog open={block !== null} title={block?.blocked ? "恢复这个终端？" : "让这个终端断网？"} detail={block?.blocked ? `${block.name ?? block.hostName ?? "该终端"} 将从 Wi-Fi 黑名单移除。` : `${block?.name ?? block?.hostName ?? "该终端"} 将加入对应 Wi-Fi 黑名单。请确认不是当前管理设备。`} confirmLabel={block?.blocked ? "确认恢复" : "确认断网"} danger={!block?.blocked} onCancel={() => setBlock(null)} onConfirm={() => void toggleClient()} /></>;
}
