// 真种草 · 新品牌买点验证 Agent — 业务单页（无客户端路由）。
//
// 页面直接调用后端 /api/analyze（初次分析）与 /api/review（反馈复盘）。
// 两条接口都由后端经 可配置模型接口 调用真实大模型；前端不接触、不存储任何 AI 凭据。
// 模型输出严格校验为 JSON，非法输出不会被渲染。
//
// fetch 一律用相对路径（"api/..."，开头不带 "/"），以适配运行时前缀。
// 内置「载入示例」「模拟反馈 A/B」仅为演示材料，载入时明确标注为模拟；
// 用户自行粘贴的反馈不会被标记为模拟材料。

import React, { useRef, useState } from "react";

// ---------------------------------------------------------------- 常量

const BRIEF_FIELDS = [
  ["本轮决策", "decision"],
  ["需要验证的问题", "questions"],
  ["参与者选择条件", "participants"],
  ["需要采集的原话和过程", "collect"],
  ["目前允许有限描述的事实", "limited_claims"],
  ["暂不使用的宣称", "blocked_claims"],
  ["必须保留的缺点和不同意见", "retain_negative_feedback"],
  ["进入下一阶段的条件", "next_stage_conditions"],
  ["尚缺材料", "missing_information"],
];

const EXAMPLE_INPUT = {
  product: "釉色手冲陶瓷滤杯（山间日常）",
  category: "咖啡周边 / 268 元",
  points: [
    "手工上釉，每一只的釉色纹路都不一样",
    "三孔锥形导流设计，萃取更均匀",
    "风味提升 40%，比市面同类产品更好喝",
    "兼容主流 V60 滤纸，可机洗",
    "新手也能冲出咖啡师水准",
  ],
  stage: "尚未试用",
  goal: "验证购买理由",
  budget: "3000",
  materials:
    "以下全部为模拟材料。\nM1：品牌提供了三只样品的图片描述：釉色纹路存在差异。\nM2：产品说明写明“三孔锥形设计”，未提供萃取对照测试。\nM3：产品说明写明兼容 V60 02 滤纸，未提供实际适配记录。\nM4：未提供机洗耐久测试。\nM5：未提供“风味提升 40%”的指标定义、实验方法和测试结果。\nM6：未提供新手学习效果的体验记录。",
};

const FEEDBACK_A_TEXT =
  "F1｜有一年手冲经验｜“我想试主要是因为釉色，冲起来有没有更好喝我说不上来。”\n" +
  "F2｜日常使用 V60 02｜“我这包滤纸能用，但冲完清理比我预想麻烦。”\n" +
  "F3｜每周手冲三次｜“外观我喜欢，不过清洗比较费事，不一定会每天用。”\n" +
  "F4｜重视器具外观｜“268 元我还会比较，喜欢图片不代表现在就买。”";

const FEEDBACK_B_TEXT =
  "F1｜重视器具外观｜“我选它是喜欢图片那只，收到的颜色不一样，有点失望。”\n" +
  "F2｜有手冲经验｜“每只不一样听着挺好，但我希望买之前知道自己会收到哪只。”\n" +
  "F3｜日常使用 V60 02｜“滤纸这次能用，但我不能判断长期怎么样。”\n" +
  "F4｜有手冲经验｜“我没有感觉风味提升 40%，也不知道这个数字怎么来的。”";

const STATUS_CLS = { 材料支持: "ok", 待补证: "pending", 材料存在矛盾: "conflict" };
const USE_CLS = { 可有限使用: "use-ok", 暂不用于推广: "use-block", 先验证用户价值: "use-verify" };
const STATUS_ORDER = { 材料存在矛盾: 0, 待补证: 1, 材料支持: 2 };

// ---------------------------------------------------------------- 工具

function pointsArray(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inputFingerprint(f) {
  return JSON.stringify([
    (f.product || "").trim(),
    (f.category || "").trim(),
    pointsArray(f.points),
    f.stage || "",
    f.goal || "",
    (f.budget || "").trim(),
    (f.materials || "").trim(),
  ]);
}

const EMPTY_FORM = {
  product: "",
  category: "",
  points: "",
  stage: "",
  goal: "",
  budget: "",
  materials: "",
};

// 示例表单的指纹：当前输入与之完全一致时，展示「模拟材料」提示。
const EXAMPLE_FP = inputFingerprint({
  product: EXAMPLE_INPUT.product,
  category: EXAMPLE_INPUT.category,
  points: EXAMPLE_INPUT.points.join("\n"),
  stage: EXAMPLE_INPUT.stage,
  goal: EXAMPLE_INPUT.goal,
  budget: EXAMPLE_INPUT.budget,
  materials: EXAMPLE_INPUT.materials,
});

// 主要证据缺口：待补证与存在矛盾的宣称，矛盾优先。
function gapClaims(claims, n) {
  return (claims || [])
    .filter((c) => c.status === "材料存在矛盾" || c.status === "待补证")
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3))
    .slice(0, n);
}

// 优先验证问题：优先取缺口宣称的下一步动作，去重后最多 n 条。
function priorityActions(claims, n) {
  const all = claims || [];
  const gaps = all.filter((c) => c.status === "材料存在矛盾" || c.status === "待补证");
  const ordered = gaps.length > 0 ? gaps : all;
  const out = [];
  for (const c of ordered) {
    if (c.next_action && !out.includes(c.next_action)) out.push(c.next_action);
    if (out.length >= n) break;
  }
  return out;
}

// ---------------------------------------------------------------- 小组件

function SourceChips({ ids }) {
  if (!ids || ids.length === 0) return <span className="chip chip-empty">无支持材料</span>;
  return (
    <span className="chips">
      {ids.map((id) => (
        <span className="chip" key={id}>
          {id}
        </span>
      ))}
    </span>
  );
}

function StatusBadge({ status }) {
  return <span className={"badge " + (STATUS_CLS[status] || "pending")}>{status}</span>;
}

// 右侧空状态：仅流程引导，不展示任何虚构分析、分数或指标，不触发模型调用。
function EmptyGuide({ onLoadExample, busy }) {
  return (
    <section className="panel empty-guide">
      <h2 className="eg-title">从一条卖点开始</h2>
      <p className="eg-desc">填写产品，或载入示例体验完整流程。</p>
      <ol className="eg-steps">
        <li>
          <span className="eg-num">01</span>
          <div>
            <div className="eg-step-title">检查证据</div>
            <div className="eg-step-desc">把卖点拆成可判断的宣称，查看材料支持程度与缺口</div>
          </div>
        </li>
        <li>
          <span className="eg-num">02</span>
          <div>
            <div className="eg-step-title">设计验证</div>
            <div className="eg-step-desc">生成最小验证计划与预先写明的决策规则</div>
          </div>
        </li>
        <li>
          <span className="eg-num">03</span>
          <div>
            <div className="eg-step-title">根据反馈更新决策</div>
            <div className="eg-step-desc">回收体验反馈后，更新判断并生成下一轮 brief</div>
          </div>
        </li>
      </ol>
      <div className="eg-actions">
        <button type="button" className="btn btn-secondary" onClick={onLoadExample} disabled={busy}>
          载入示例
        </button>
      </div>
    </section>
  );
}

// 结果面板头部：顶部标签页之下的「当前结论 → 关键依据」，详细内容在标签页内展开。
// 摘要只使用本次模型输出，不新增事实。
function ResultHead({ initial, decision }) {
  if (decision) {
    const changes = (decision.changes || []).slice(0, 3);
    return (
      <div className="result-head">
        <div className="rh-top">
          <span className="rh-eyebrow">当前结论 · 决策更新</span>
          <span className="conclusion-badge">{decision.conclusion_enum}</span>
        </div>
        <p className="rh-text">{decision.conclusion}</p>

        <div className="rh-sec-h">
          <span className="rh-dot amber" />
          关键依据
        </div>
        <ul className="rh-list">
          {changes.map((c, i) => (
            <li key={i}>
              <span className="rh-li-main">{c.item}</span>
              <SourceChips ids={c.source_ids} />
            </li>
          ))}
          {changes.length === 0 && <li className="rh-li-empty">本次未产生判断变化。</li>}
        </ul>
      </div>
    );
  }

  const gaps = gapClaims(initial.claims, 3);
  const actions = priorityActions(initial.claims, 3);
  return (
    <div className="result-head">
      <div className="rh-top">
        <span className="rh-eyebrow">当前结论 · 初步分析</span>
      </div>
      <p className="rh-text">{initial.summary}</p>

      <div className="rh-sec-h">
        <span className="rh-dot amber" />
        主要证据缺口
      </div>
      <ul className="rh-list">
        {gaps.map((c) => (
          <li key={c.id}>
            <span className="rh-li-main">{c.claim}</span>
            <span className="rh-li-side">
              <StatusBadge status={c.status} />
              <SourceChips ids={c.source_ids} />
            </span>
          </li>
        ))}
        {gaps.length === 0 && <li className="rh-li-empty">本次材料未发现明显证据缺口。</li>}
      </ul>

      <div className="rh-sec-h">
        <span className="rh-dot red" />
        优先验证问题
      </div>
      <ol className="rh-steps">
        {actions.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ol>
    </div>
  );
}

// 证据体检
function Evidence({ claims }) {
  const counts = { 材料支持: 0, 待补证: 0, 材料存在矛盾: 0 };
  claims.forEach((c) => {
    if (counts[c.status] !== undefined) counts[c.status] += 1;
  });
  return (
    <div className="tab-body">
      <div className="block-head">
        <h3 className="block-title">证据体检</h3>
        <p className="block-sub">
          把每条原始卖点拆成可单独判断的宣称，判断材料支持到什么程度、还缺什么、暂时能否用于推广。
        </p>
      </div>

      <div className="evidence-summary">
        <b>证据状态统计：</b>
        <span className="badge ok">{counts["材料支持"]} 条 材料支持</span>
        <span className="badge pending">{counts["待补证"]} 条 待补证</span>
        <span className="badge conflict">{counts["材料存在矛盾"]} 条 材料存在矛盾</span>
        <span className="disclaimer">这是材料状态统计，不是产品质量、法律合规或投放效果评分。</span>
      </div>

      {claims.map((c, i) => (
        <div className="claim" key={c.id || i}>
          <div className="claim-head">
            <span className="claim-title">{c.claim}</span>
            <span className="claim-badges">
              <StatusBadge status={c.status} />
              <span className={"badge " + (USE_CLS[c.promotion_use] || "use-verify")}>
                推广建议：{c.promotion_use}
              </span>
            </span>
          </div>
          <div className="claim-original">原始宣称：{c.original}</div>
          <div className="kv source">
            <span className="k">引用材料</span>
            <span className="v">
              <SourceChips ids={c.source_ids} />
            </span>
          </div>
          <div className="kv">
            <span className="k">材料支持程度</span>
            <span className="v">{c.supported_scope}</span>
          </div>
          <div className="kv">
            <span className="k">尚不能推出的结论</span>
            <span className="v">{c.limitations}</span>
          </div>
          <div className="kv">
            <span className="k">下一步验证动作</span>
            <span className="v">{c.next_action}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// 验证计划（买点假设 + 最小验证计划）
function PlanTab({ initial }) {
  return (
    <div className="tab-body">
      <div className="block-head">
        <h3 className="block-title">待验证买点</h3>
        <p className="block-sub">
          区分“产品特点是否属实”和“产品特点是否影响用户选择”，只给出最优先的假设。
        </p>
      </div>
      {(initial.hypotheses || []).map((x, i) => (
        <div className="hypo" key={x.id || i}>
          <div className="hypo-title">
            <span className="hypo-tag">{x.id}</span>
            {x.hypothesis}
          </div>
          <div className="kv">
            <span className="k">谁在什么情况下产生什么需求</span>
            <span className="v">{x.user_context}</span>
          </div>
          <div className="kv">
            <span className="k">可能影响选择的产品特点</span>
            <span className="v">{x.feature}</span>
          </div>
          <div className="kv">
            <span className="k">目前支持依据</span>
            <span className="v">
              {x.basis}
              {x.source_ids && x.source_ids.length ? `（${x.source_ids.join("、")}）` : ""}
            </span>
          </div>
          <div className="kv">
            <span className="k">替代解释</span>
            <span className="v">{x.alternative_explanation}</span>
          </div>
          <div className="kv">
            <span className="k">会推翻该假设的反馈</span>
            <span className="v">{x.disconfirming_signal}</span>
          </div>
          <div className="kv">
            <span className="k">优先级理由</span>
            <span className="v">{x.priority_reason}</span>
          </div>
        </div>
      ))}

      {(() => {
        const plan = initial.plan || {};
        return (
          <>
            <div className="block-head" style={{ marginTop: 22 }}>
              <h3 className="block-title">最小验证计划</h3>
              <p className="block-sub">
                本轮是小规模产品体验研究，不等于公开投放：先采集反馈，不要求参与者发布笔记，不要求正面评价。
              </p>
            </div>

            <div className="plan-head">{plan.stage_title}</div>
            <ul className="kv-list">
              <li>
                <b>招募：</b>
                {plan.participants}
              </li>
              <li className="plan-note">{plan.participants_note}</li>
              <li>
                <b>周期：</b>
                {plan.duration}
              </li>
              <li>
                <b>预算：</b>
                {plan.budget_note}
              </li>
            </ul>

            <div className="plan-head">采集问题</div>
            <ol className="num-list">
              {(plan.collection_questions || []).map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>

            <div className="plan-head">体验证据</div>
            <p className="plan-note">{plan.experience_evidence}</p>

            <div className="plan-head">预先写明的决策规则</div>
            <ol className="num-list">
              {(plan.decision_rules || []).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ol>

            <div className="plan-head">公开内容合作准备</div>
            <ul className="bullet-list">
              {(plan.cooperation_prep || []).map((cp, i) => (
                <li key={i}>{cp}</li>
              ))}
            </ul>
          </>
        );
      })()}
    </div>
  );
}

// 决策更新：桌面为紧凑四列对比表（判断项｜初次判断｜更新后建议｜依据），
// 详细原因可展开；手机端同一数据渲染为逐项卡片（CSS 切换，data-l 提供标签）。
function DecisionTab({ decision, onCopy }) {
  const changes = decision.changes || [];
  return (
    <div className="tab-body">
      <div className="block-head">
        <h3 className="block-title">初次判断 vs 更新建议</h3>
        <p className="block-sub">
          根据新材料更新判断，仅基于本次输入与规则，不代表示范样本足够或市场已获验证。
        </p>
      </div>

      {changes.length > 0 ? (
        <div className="cmp-list">
          <div className="cmp-grid-head" aria-hidden="true">
            <span>判断项</span>
            <span>初次判断</span>
            <span>更新后建议</span>
            <span>依据</span>
          </div>
          {changes.map((c, i) => (
            <div className="cmp-item" key={i}>
              <div className="cmp-grid">
                <span className="c-item">{c.item}</span>
                <span className="c-before" data-l="初次判断">
                  {c.before}
                </span>
                <span className="c-after" data-l="更新后建议">
                  {c.after}
                </span>
                <span className="c-src" data-l="依据">
                  <SourceChips ids={c.source_ids} />
                </span>
              </div>
              <details className="cmp-why">
                <summary>详细依据</summary>
                <p className="cmp-reason">{c.reason}</p>
              </details>
            </div>
          ))}
        </div>
      ) : (
        <div className="cmp-empty">本次未产生判断变化。</div>
      )}

      {(decision.unchanged || []).length > 0 && (
        <>
          <div className="section-h">未改变的判断</div>
          <ul className="unchanged-list">
            {decision.unchanged.map((u, i) => (
              <li key={i}>
                <b>{u.item}</b>
                <span>{u.reason}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="section-h">下一步</div>
      <ul className="next-list">
        {(decision.next_actions || []).map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>

      <details className="brief">
        <summary className="brief-sum">
          <span className="brief-title">下一轮验证 brief</span>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCopy(decision.brief);
            }}
          >
            复制 brief
          </button>
        </summary>
        <div className="brief-body">
          {BRIEF_FIELDS.map(([label, key]) => (
            <div className="brief-row" key={key}>
              <span className="bk">{label}</span>
              <span className="bv">{decision.brief ? decision.brief[key] : ""}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------- 主组件

export default function App() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [initial, setInitial] = useState(null);
  const [analyzedFp, setAnalyzedFp] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);

  const [feedback, setFeedback] = useState("");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [feedbackSim, setFeedbackSim] = useState(false);
  const [decision, setDecision] = useState(null);
  const [decisionFp, setDecisionFp] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState(null);

  const [tab, setTab] = useState("evidence");
  const [moreOpen, setMoreOpen] = useState(false);

  const formRef = useRef(form);
  formRef.current = form;
  const feedbackRef = useRef(feedback);
  feedbackRef.current = feedback;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const analyzedFpRef = useRef(analyzedFp);
  analyzedFpRef.current = analyzedFp;

  const analyzeSeq = useRef(0);
  const reviewSeq = useRef(0);

  const curFp = inputFingerprint(form);
  const analysisStale = analyzedFp !== null && analyzedFp !== curFp;
  const decisionStale = decisionFp !== null && decisionFp !== curFp + "|" + feedback.trim();
  const showInitial = initial !== null && !analysisStale;
  const showDecision = decision !== null && !decisionStale;
  const isExampleActive = curFp === EXAMPLE_FP;

  function setField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function loadExample() {
    setForm({
      product: EXAMPLE_INPUT.product,
      category: EXAMPLE_INPUT.category,
      points: EXAMPLE_INPUT.points.join("\n"),
      stage: EXAMPLE_INPUT.stage,
      goal: EXAMPLE_INPUT.goal,
      budget: EXAMPLE_INPUT.budget,
      materials: EXAMPLE_INPUT.materials,
    });
    setAnalyzeError(null);
  }

  async function handleAnalyze() {
    const f = formRef.current;
    const pts = pointsArray(f.points);
    if (!f.product.trim() || !f.category.trim() || pts.length === 0) {
      setAnalyzeError("请至少填写产品名、品类/价格和一条核心卖点后再分析。");
      return;
    }
    const fp = inputFingerprint(f);
    setAnalyzeError(null);
    setAnalyzing(true);
    const seq = ++analyzeSeq.current;
    try {
      const res = await fetch("api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product: f.product.trim(),
          category: f.category.trim(),
          points: pts,
          stage: f.stage,
          goal: f.goal,
          budget: (f.budget || "").trim(),
          materials: f.materials.trim(),
        }),
      });
      const data = await res.json();
      if (seq !== analyzeSeq.current) return;
      if (!res.ok || !data.ok) {
        setAnalyzeError((data && data.error) || "模型调用失败，请重试。");
        return;
      }
      // 请求期间输入已变化 → 丢弃结果，不覆盖新输入。
      if (inputFingerprint(formRef.current) !== fp) return;
      setInitial(data.result);
      setAnalyzedFp(fp);
      setDecision(null);
      setDecisionFp(null);
      setFeedback("");
      setFeedbackNote("");
      setFeedbackSim(false);
      setReviewError(null);
      setTab("evidence");
    } catch (e) {
      if (seq !== analyzeSeq.current) return;
      setAnalyzeError("网络或服务错误，请重试：" + (e && e.message ? e.message : e));
    } finally {
      if (seq === analyzeSeq.current) setAnalyzing(false);
    }
  }

  async function handleReview() {
    const f = formRef.current;
    const fb = feedbackRef.current.trim();
    const init = initialRef.current;
    if (!init || analyzedFpRef.current === null || inputFingerprint(f) !== analyzedFpRef.current) {
      setReviewError("输入已修改，请先重新点击「分析证据与买点」。");
      return;
    }
    if (!fb) {
      setReviewError("请先载入示例反馈或粘贴材料后再更新决策。");
      return;
    }
    const fp = curFp + "|" + fb;
    setReviewError(null);
    setReviewing(true);
    const seq = ++reviewSeq.current;
    try {
      const res = await fetch("api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: {
            product: f.product.trim(),
            category: f.category.trim(),
            points: pointsArray(f.points),
            materials: f.materials.trim(),
          },
          feedback: fb,
          initial: init,
        }),
      });
      const data = await res.json();
      if (seq !== reviewSeq.current) return;
      if (!res.ok || !data.ok) {
        setReviewError((data && data.error) || "模型调用失败，请重试。");
        return;
      }
      const curFpNow = inputFingerprint(formRef.current) + "|" + feedbackRef.current.trim();
      if (curFpNow !== fp) return; // 请求期间输入/反馈已变化
      setDecision(data.result.decision);
      setDecisionFp(fp);
      setTab("decision");
    } catch (e) {
      if (seq !== reviewSeq.current) return;
      setReviewError("网络或服务错误，请重试：" + (e && e.message ? e.message : e));
    } finally {
      if (seq === reviewSeq.current) setReviewing(false);
    }
  }

  // 载入内置模拟反馈：标记为模拟材料；用户手动编辑后标记自动消失。
  function loadFeedback(text, note) {
    setFeedback(text);
    setFeedbackNote(note);
    setFeedbackSim(true);
    setReviewError(null);
  }

  function copyBrief(brief) {
    const text = BRIEF_FIELDS.map(([label, key]) => `【${label}】\n${brief[key]}`).join("\n\n");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(null, () => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
    } catch (_) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  const busy = analyzing || reviewing;
  const tabs = [
    { id: "evidence", label: "证据体检" },
    { id: "plan", label: "验证计划" },
    { id: "decision", label: "决策更新" },
  ];
  const currentStep = showDecision ? 3 : showInitial ? (tab === "plan" ? 2 : 1) : 0;

  return (
    <div className="page">
      {/* 顶部 */}
      <header className="topbar">
        <div className="brand">
          <span className="brand-leaf" aria-hidden="true">
            ✦
          </span>
          <span className="brand-name">真种草 · 新品牌买点验证</span>
        </div>
        <ol className="steps">
          {["产品信息", "证据体检", "验证计划", "决策更新"].map((s, i) => (
            <li key={s} className={"step" + (i === currentStep ? " step-active" : "")}>
              <span className="step-num">{i + 1}</span>
              <span className="step-label">{s}</span>
            </li>
          ))}
        </ol>
      </header>

      <div className="intro">
        <h1>先验证买点，再决定投放。</h1>
        <p className="intro-sub">用证据明确下一步，让每一轮试错都有依据。</p>
      </div>

      {/* 工作台：左输入 右结果 */}
      <div className="workbench">
        {/* 左：产品信息与材料 */}
        <aside className="col-left">
          <section className="panel input-panel">
            <div className="panel-head-row">
              <h2 className="panel-title">产品信息与材料</h2>
              <span className="mode-badge">✦ AI 分析</span>
              <span className="head-flex" />
              <button type="button" className="btn-mini" onClick={loadExample} disabled={busy}>
                载入示例
              </button>
            </div>
            <p className="panel-sub">填写产品与材料，分析买点和证据缺口。</p>
            {isExampleActive && (
              <div className="sim-note">当前载入的是模拟材料，非真实调研。</div>
            )}

            <div className="field">
              <label htmlFor="product">
                产品名 <span className="req">必填</span>
              </label>
              <input
                type="text"
                id="product"
                autoComplete="off"
                value={form.product}
                onChange={(e) => setField("product", e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="category">
                品类 / 价格 <span className="req">必填</span>
              </label>
              <input
                type="text"
                id="category"
                autoComplete="off"
                value={form.category}
                onChange={(e) => setField("category", e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="points">
                核心卖点 <span className="req">必填 · 每行一条</span>
              </label>
              <textarea
                id="points"
                className="ta-points"
                placeholder="每行一条卖点"
                value={form.points}
                onChange={(e) => setField("points", e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="materials">
                可用材料 <span className="opt">选填</span>
              </label>
              <textarea
                id="materials"
                className="ta-materials"
                placeholder="产品说明、测试材料摘要、用户原话等，可直接粘贴"
                value={form.materials}
                onChange={(e) => setField("materials", e.target.value)}
              />
              <details className="fmt-help">
                <summary>材料怎么填写</summary>
                <div className="hint">
                  可填写：材料编号｜来源｜材料摘要，或直接粘贴产品说明、测试摘要、用户原话。材料缺失允许分析，但会明确标注缺口。
                </div>
              </details>
            </div>

            <details className="more" open={moreOpen} onToggle={(e) => setMoreOpen(e.target.open)}>
              <summary>更多信息（选填）</summary>
              <div className="more-body">
                <div className="field">
                  <label htmlFor="stage">当前阶段</label>
                  <select id="stage" value={form.stage} onChange={(e) => setField("stage", e.target.value)}>
                    <option value="">（未选择）</option>
                    <option value="尚未试用">尚未试用</option>
                    <option value="已有少量试用">已有少量试用</option>
                    <option value="已有投放反馈">已有投放反馈</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="goal">本轮目标</label>
                  <select id="goal" value={form.goal} onChange={(e) => setField("goal", e.target.value)}>
                    <option value="">（未选择）</option>
                    <option value="验证购买理由">验证购买理由</option>
                    <option value="排查体验阻碍">排查体验阻碍</option>
                    <option value="判断是否扩大投放">判断是否扩大投放</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="budget">验证预算上限（元）</label>
                  <input
                    type="number"
                    id="budget"
                    min="0"
                    placeholder="例如 3000"
                    value={form.budget}
                    onChange={(e) => setField("budget", e.target.value)}
                  />
                </div>
              </div>
            </details>

            <div className="controls">
              <button type="button" className="btn btn-primary" onClick={handleAnalyze} disabled={busy}>
                {analyzing ? "分析中…" : "分析证据与买点"}
              </button>
            </div>

            {analyzeError && (
              <div className="tip tip-error" role="alert">
                {analyzeError}
              </div>
            )}
            {analyzing && (
              <div className="status-line" aria-live="polite">
                <span className="spinner" />
                <span className="status-text">正在整理证据与买点…</span>
              </div>
            )}
          </section>
        </aside>

        {/* 右：结果 / 计划 / 反馈 */}
        <main className="col-right">
          {analysisStale && (
            <div className="tip tip-error" role="alert">
              输入已修改，下方旧结果已失效，请重新点击「分析证据与买点」。
            </div>
          )}

          {!showInitial && <EmptyGuide onLoadExample={loadExample} busy={busy} />}

          {showInitial && (
            <section className="results-card">
              <div className="tabbar" role="tablist">
                {tabs.map((t) => {
                  const disabled = t.id === "decision" && !showDecision;
                  return (
                    <button
                      key={t.id}
                      role="tab"
                      type="button"
                      aria-selected={tab === t.id}
                      className={"tab" + (tab === t.id ? " tab-active" : "")}
                      onClick={() => setTab(t.id)}
                      disabled={disabled && tab !== t.id}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              <ResultHead initial={initial} decision={showDecision ? decision : null} />

              {tab === "evidence" && <Evidence claims={initial.claims} />}
              {tab === "plan" && <PlanTab initial={initial} />}
              {tab === "decision" &&
                (showDecision ? (
                  <DecisionTab decision={decision} onCopy={copyBrief} />
                ) : (
                  <div className="tab-body">
                    <div className="empty-note">
                      还没有决策更新。在下方「补充体验反馈」载入或粘贴反馈后，点击「更新决策」。
                    </div>
                  </div>
                ))}
            </section>
          )}

          {/* 反馈区 */}
          {showInitial && (
            <section className="panel feedback-panel">
              <h2 className="panel-title">补充体验反馈</h2>
              <p className="panel-sub">粘贴体验反馈，或载入内置模拟反馈演示流程。</p>

              <div className="field">
                <label htmlFor="feedback">
                  材料与反馈
                  {feedbackSim && <span className="sim-tag">模拟材料</span>}
                </label>
                <textarea
                  id="feedback"
                  placeholder={"材料编号｜参与者背景｜反馈原话\n非体验材料可填写：材料编号｜来源｜材料摘要"}
                  value={feedback}
                  onChange={(e) => {
                    setFeedback(e.target.value);
                    setFeedbackSim(false);
                    setFeedbackNote("");
                    setReviewError(null);
                  }}
                />
              </div>

              <div className="controls">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => loadFeedback(FEEDBACK_A_TEXT, "已载入模拟反馈 A。")}
                  disabled={busy}
                >
                  模拟反馈 A
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => loadFeedback(FEEDBACK_B_TEXT, "已载入模拟反馈 B。")}
                  disabled={busy}
                >
                  模拟反馈 B
                </button>
                <button type="button" className="btn btn-primary" onClick={handleReview} disabled={busy}>
                  {reviewing ? "更新中…" : "更新决策"}
                </button>
              </div>

              {feedbackNote && <div className="tip tip-amber">{feedbackNote}</div>}
              {decisionStale && (
                <div className="tip tip-amber" role="status">
                  反馈已变化，请重新分析：旧决策已失效，旧 brief 不可复制。
                </div>
              )}
              {reviewError && (
                <div className="tip tip-error" role="alert">
                  {reviewError}
                </div>
              )}
              {reviewing && (
                <div className="status-line" aria-live="polite">
                  <span className="spinner" />
                  <span className="status-text">正在根据新材料更新决策…</span>
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {/* 底部：两个可展开说明区 */}
      <div className="foot-folds">
        <details className="panel-fold">
          <summary>我想验证的商业价值</summary>
          <div className="fold-body">
            <p className="fold-p">
              本工具的价值假设是：在放大投放前识别买点与体验之间的差异，减少错误方向上的预算投入，以及
              brief 返工。
            </p>
            <ul className="metric-list">
              <li>完成一份可执行验证 brief 的时间</li>
              <li>brief 的修改轮次</li>
              <li>缺乏证据的宣称进入内容的比例</li>
              <li>一轮体验后，能否做出有依据的继续或停止决策</li>
            </ul>
            <p className="metric-note">
              上述指标尚未通过实际实验验证。本 Demo 不声称已经提升转化率或降低获客成本。
            </p>
          </div>
        </details>

        <details className="panel-fold">
          <summary>产品边界</summary>
          <div className="fold-body">
            <p className="fold-p">
              AI
              负责整理材料、识别缺口、设计验证和辅助复盘；实际体验需要真实参与者完成，产品事实需要对应材料支持，最终商业决策由品牌负责人确认。
            </p>
            <p className="fold-p muted">
              本 Demo
              聚焦体验招募或投放前的验证设计，以及材料回收后的决策解释。未来可作为既有众测、达人合作工作流的辅助环节，不声称替代这些工具，也不声称已接入。
            </p>
          </div>
        </details>
      </div>

      <footer>虚构品牌与模拟材料用于作品演示，不代表真实调研结果。</footer>
    </div>
  );
}
