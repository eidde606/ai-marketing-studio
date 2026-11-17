import { createContext } from "react";
import type { AccountResponse, Language } from "../services/accountApi";
import type { Translate } from "./localization";

export type LocalizationContextValue = {
  locale: Language;
  setInterfaceLanguage: (language: Language) => Promise<boolean>;
  saveAccountPreferences: (
    preferences: Partial<AccountResponse["preferences"]>,
  ) => Promise<void>;
  t: Translate;
  account: AccountResponse | null;
  accountLoading: boolean;
  accountError: Error | null;
  preferenceError: boolean;
  refreshAccount: () => Promise<void>;
};

const defaultContext: LocalizationContextValue = {
  locale: "en",
  setInterfaceLanguage: async () => true,
  saveAccountPreferences: async () => {},
  t: (key) => key,
  account: null,
  accountLoading: false,
  accountError: null,
  preferenceError: false,
  refreshAccount: async () => {},
};

export const LocalizationContext =
  createContext<LocalizationContextValue>(defaultContext);

export function initializeDefaultLocalizationContext(
  value: LocalizationContextValue,
) {
  Object.assign(defaultContext, value);
}
