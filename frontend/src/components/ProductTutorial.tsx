import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, BookOpen, Check, Sparkles } from "lucide-react";
import { useLocalization } from "../app/useLocalization";
import type { Section } from "./Sidebar";

type Props = {
  activeSection: Section;
  initialStep: number;
  onComplete: (step: number) => Promise<void>;
  onDismiss: () => void;
  onNavigate: (section: Section) => void;
  onPause: (step: number) => Promise<void>;
  onStepChange: (step: number) => Promise<void>;
};

const tutorialSlides = [
  {
    title: "tutorial.welcomeTitle",
    body: "tutorial.welcomeBody",
    section: "Resumen",
    target: "dashboard-overview",
  },
  {
    title: "tutorial.sofiaTitle",
    body: "tutorial.sofiaBody",
    section: "Equipo IA",
    target: "sofia-overview",
  },
  {
    title: "tutorial.leoTitle",
    body: "tutorial.leoBody",
    section: "Equipo IA",
    target: "leo-generation",
  },
  {
    title: "tutorial.miaTitle",
    body: "tutorial.miaBody",
    section: "Analíticas",
    target: "mia-analytics",
  },
  {
    title: "tutorial.creationTitle",
    body: "tutorial.creationBody",
    section: "Resumen",
    target: "quick-create",
  },
  {
    title: "tutorial.guidedTitle",
    body: "tutorial.guidedBody",
    section: "Equipo IA",
    target: "sofia-guided",
  },
  {
    title: "tutorial.campaignTitle",
    body: "tutorial.campaignBody",
    section: "Campañas",
    target: "campaign-create",
  },
  {
    title: "tutorial.reviewTitle",
    body: "tutorial.reviewBody",
    section: "Aprobaciones",
    target: "approval-queue",
  },
  {
    title: "tutorial.publishingTitle",
    body: "tutorial.publishingBody",
    section: "Aprobaciones",
    target: "publish-options",
  },
  {
    title: "tutorial.trialTitle",
    body: "tutorial.trialBody",
    section: "Configuración",
    target: "trial-settings",
  },
] as const satisfies ReadonlyArray<{
  title: string;
  body: string;
  section: Section;
  target: string;
}>;

export default function ProductTutorial({
  activeSection,
  initialStep,
  onComplete,
  onDismiss,
  onNavigate,
  onPause,
  onStepChange,
}: Props) {
  const { t } = useLocalization();
  const [step, setStep] = useState(() =>
    Math.min(Math.max(initialStep, 0), tutorialSlides.length - 1),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [finished, setFinished] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const slide = tutorialSlides[step];

  useEffect(() => {
    if (activeSection !== slide.section) {
      onNavigate(slide.section);
      return;
    }

    const target = document.querySelector<HTMLElement>(
      `[data-guide-target="${slide.target}"]`,
    );
    if (!target) return;
    target.classList.add("product-guide-highlight");
    target.scrollIntoView?.({ behavior: "smooth", block: "center" });
    return () => target.classList.remove("product-guide-highlight");
  }, [activeSection, onNavigate, slide.section, slide.target]);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step, finished]);

  async function skip() {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await onComplete(step);
      onDismiss();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  async function pause() {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await onPause(step);
    } catch {
      setError(true);
      setSaving(false);
    }
  }

  async function finish() {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await onComplete(step);
      setFinished(true);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function navigateTo(section: Section) {
    onDismiss();
    onNavigate(section);
  }

  async function moveTo(nextStep: number) {
    if (saving || finished || nextStep < 0 || nextStep >= tutorialSlides.length)
      return;
    setSaving(true);
    setError(false);
    try {
      await onStepChange(nextStep);
      setStep(nextStep);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void pause();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      void moveTo(step - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      void moveTo(step + 1);
    }
  }

  return (
    <aside
      className="product-guide panel"
      aria-label={t("tutorial.title")}
      onKeyDown={handleKeyDown}
      aria-live="polite"
    >
      <div className="product-guide__brand">
        <span className="product-guide__icon" aria-hidden="true">
          {finished ? <Check size={20} /> : <Sparkles size={20} />}
        </span>
        <span className="eyebrow">{t("tutorial.title")}</span>
        {!finished && (
          <button
            type="button"
            className="product-guide__pause"
            onClick={() => void pause()}
            disabled={saving}
            aria-label={t("tutorial.saveAndExit")}
          >
            {t("tutorial.saveAndExit")}
          </button>
        )}
      </div>
      {!finished ? (
        <>
          <div
            className="product-guide__progress"
            role="progressbar"
            aria-label={t("tutorial.progress")}
            aria-valuemin={1}
            aria-valuemax={tutorialSlides.length}
            aria-valuenow={step + 1}
          >
            <span
              style={{
                width: `${((step + 1) / tutorialSlides.length) * 100}%`,
              }}
            />
          </div>
          <p className="product-guide__step">
            {t("tutorial.stepCount", {
              step: step + 1,
              total: tutorialSlides.length,
            })}
          </p>
          <h2 id="tutorial-title" ref={headingRef} tabIndex={-1}>
            {t(slide.title)}
          </h2>
          <p className="product-guide__body">{t(slide.body)}</p>
        </>
      ) : (
        <div className="product-guide__completion">
          <p className="eyebrow">{t("tutorial.completeEyebrow")}</p>
          <h2 id="tutorial-title" ref={headingRef} tabIndex={-1}>
            {t("tutorial.completeTitle")}
          </h2>
          <p className="product-guide__body">{t("tutorial.completeBody")}</p>
          <div className="product-guide__completion-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => navigateTo("Facturación")}
            >
              {t("tutorial.explorePlans")}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => navigateTo("Resumen")}
            >
              <BookOpen size={17} aria-hidden="true" />
              {t("tutorial.continueDashboard")}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{t("tutorial.saveError")}</p>}
      {!finished && (
        <div className="tutorial-actions">
          <button
            type="button"
            className="reject-button"
            onClick={() => void skip()}
            disabled={saving}
          >
            {saving ? t("common.saving") : t("tutorial.skip")}
          </button>
          <div>
            <button
              type="button"
              className="reject-button"
              onClick={() => void moveTo(step - 1)}
              disabled={step === 0 || saving}
            >
              {t("tutorial.back")}
            </button>
            {step < tutorialSlides.length - 1 ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => void moveTo(step + 1)}
                disabled={saving}
              >
                {saving ? t("common.saving") : t("tutorial.next")}
              </button>
            ) : (
              <button
                type="button"
                className="primary-button"
                onClick={() => void finish()}
                disabled={saving}
              >
                {saving ? t("common.saving") : t("tutorial.finish")}
              </button>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
