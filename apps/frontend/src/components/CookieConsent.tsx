import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";

import { Button } from "./ui/Button";
import { Checkbox } from "./ui/Checkbox";
import { Modal } from "./ui/Modal";
import {
  COOKIE_CONSENT_STORAGE_KEY,
  clearCookieConsentSessionOverride,
  isAnalyticsProductionHost,
  isCookieConsentPersisted,
  parseCookieConsent,
  readCookieConsent,
  writeCookieConsent,
  type CookieConsentRecord,
} from "../lib/analytics/consent";
import {
  grantAnalyticsConsent,
  initializeAnalytics,
  revokeAnalytics,
} from "../lib/analytics/ga4";

interface CookieConsentContextValue {
  analytics: boolean;
  available: boolean;
  decided: boolean;
  openPreferences: () => void;
}

const CookieConsentContext = createContext<CookieConsentContextValue>({
  analytics: false,
  available: false,
  decided: false,
  openPreferences: () => undefined,
});

export function useCookieConsent(): CookieConsentContextValue {
  return useContext(CookieConsentContext);
}

export interface CookieConsentBannerProps {
  onAccept: () => void;
  onOpenPreferences: () => void;
  onReject: () => void;
}

export function CookieConsentBanner({
  onAccept,
  onOpenPreferences,
  onReject,
}: CookieConsentBannerProps) {
  return (
    <section
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-lg border border-zinc-300 bg-white p-4 shadow-lg sm:inset-x-6 sm:p-5"
      role="region"
    >
      <h2 className="text-base font-semibold text-zinc-950">Your privacy choices</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-600">
        We use necessary storage to run Zenguy. With your permission, Google
        Analytics also measures visits, consented signed-in users and a small
        set of product milestones using a purpose-specific pseudonymous account
        identifier.
        It stays completely blocked unless you accept. We do not enable
        advertising storage or personalization. Read our{" "}
        <Link className="font-medium text-accent-700 hover:underline" to="/cookies">
          Cookie Policy
        </Link>
        .
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button className="w-full" size="lg" variant="secondary" onClick={onReject}>
          Reject analytics
        </Button>
        <Button className="w-full" size="lg" variant="secondary" onClick={onAccept}>
          Accept analytics
        </Button>
      </div>
      <button
        className="mt-3 text-sm font-medium text-accent-700 hover:underline"
        type="button"
        onClick={onOpenPreferences}
      >
        Manage preferences
      </button>
    </section>
  );
}

export interface CookieConsentChoiceEffects {
  initialize: () => boolean;
  isPersisted: (record: CookieConsentRecord) => boolean;
  reload: () => void;
  revoke: () => boolean;
  write: (analytics: boolean) => CookieConsentRecord;
}

export function applyCookieConsentChoice(
  analytics: boolean,
  effects: CookieConsentChoiceEffects = {
    initialize: grantAnalyticsConsent,
    isPersisted: isCookieConsentPersisted,
    reload: () => window.location.reload(),
    revoke: revokeAnalytics,
    write: writeCookieConsent,
  },
): CookieConsentRecord {
  // Persist first. Analytics may start, or a withdrawn document may reload,
  // only when the next document can read the same choice.
  const record = effects.write(analytics);
  const persisted = effects.isPersisted(record);
  if (analytics) {
    if (persisted) effects.initialize();
  } else if (effects.revoke() && persisted) {
    effects.reload();
  }
  return record;
}

function CookiePreferences({
  analytics,
  onChoose,
  onClose,
  open,
}: {
  analytics: boolean;
  onChoose: (analytics: boolean) => void;
  onClose: () => void;
  open: boolean;
}) {
  const [draftAnalytics, setDraftAnalytics] = useState(analytics);

  useEffect(() => {
    if (open) setDraftAnalytics(analytics);
  }, [analytics, open]);

  return (
    <Modal
      footer={
        <>
          <Button
            className="min-w-36"
            variant="secondary"
            onClick={() => onChoose(false)}
          >
            Reject analytics
          </Button>
          <Button
            className="min-w-36"
            variant="primary"
            onClick={() => onChoose(draftAnalytics)}
          >
            Save selection
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title="Cookie preferences"
    >
      <div className="space-y-4 text-sm leading-6 text-zinc-600">
        <div className="rounded-md border border-zinc-200 p-3">
          <p className="font-medium text-zinc-900">Necessary storage</p>
          <p className="mt-1">
            Always active. It provides sessions, security and remembers this
            preference; it is not used for advertising.
          </p>
        </div>
        <label className="flex items-start gap-3 rounded-md border border-zinc-200 p-3">
          <Checkbox
            checked={draftAnalytics}
            className="mt-1"
            onChange={(event) => setDraftAnalytics(event.currentTarget.checked)}
          />
          <span>
            <span className="block font-medium text-zinc-900">Analytics</span>
            <span className="mt-1 block">
              Allow Google Analytics to measure normalized page categories,
              consented signed-in users, registration and confirmed checkout
              milestones. The account identifier is purpose-specific and
              pseudonymous. Form contents, names, emails, tokens, test URLs and
              workspace/resource IDs are excluded.
            </span>
          </span>
        </label>
        <p>
          You can change or withdraw this choice at any time. This preference
          is stored separately on each Zenguy subdomain because browser local
          storage is not shared between subdomains.
        </p>
      </div>
    </Modal>
  );
}

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const available = isAnalyticsProductionHost();
  const [record, setRecord] = useState<CookieConsentRecord | null>(() =>
    available ? readCookieConsent() : null,
  );
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const choose = useCallback((analytics: boolean) => {
    const next = applyCookieConsentChoice(analytics);
    setRecord(next);
    setPreferencesOpen(false);
  }, []);

  useEffect(() => {
    if (!available) return undefined;
    if (record?.analytics === true) initializeAnalytics();
    else revokeAnalytics();

    const syncChoice = (event: StorageEvent) => {
      if (event.key !== COOKIE_CONSENT_STORAGE_KEY && event.key !== null) return;
      clearCookieConsentSessionOverride();
      const next =
        event.key === null ? null : parseCookieConsent(event.newValue);
      setRecord(next);
      if (next?.analytics === true) grantAnalyticsConsent();
      else if (revokeAnalytics()) window.location.reload();
    };
    window.addEventListener("storage", syncChoice);
    return () => window.removeEventListener("storage", syncChoice);
  }, [available, record?.analytics]);

  const context: CookieConsentContextValue = {
    analytics: available && record?.analytics === true,
    available,
    decided: available && record !== null,
    openPreferences: () => setPreferencesOpen(true),
  };

  return (
    <CookieConsentContext.Provider value={context}>
      {children}
      {available && record === null && !preferencesOpen ? (
        <CookieConsentBanner
          onAccept={() => choose(true)}
          onOpenPreferences={() => setPreferencesOpen(true)}
          onReject={() => choose(false)}
        />
      ) : null}
      {available && record !== null && !preferencesOpen ? (
        <Button
          aria-haspopup="dialog"
          className="fixed bottom-3 left-3 z-40 shadow-sm"
          size="sm"
          variant="secondary"
          onClick={() => setPreferencesOpen(true)}
        >
          Cookie preferences
        </Button>
      ) : null}
      {available ? (
        <CookiePreferences
          analytics={record?.analytics ?? false}
          onChoose={choose}
          onClose={() => setPreferencesOpen(false)}
          open={preferencesOpen}
        />
      ) : null}
    </CookieConsentContext.Provider>
  );
}
