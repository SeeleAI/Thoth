import { useCallback, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { getDesktopHost } from "@/desktop/host";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useBrowserStore } from "@/stores/browser-store";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { clearDesktopBrowserData } from "./browser-data-controller";

export function BrowserDataSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const clearInFlightRef = useRef(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClear = useCallback(async () => {
    if (clearInFlightRef.current) {
      return;
    }

    clearInFlightRef.current = true;
    setIsClearing(true);
    try {
      const result = await clearDesktopBrowserData({
        confirm: () =>
          confirmDialog({
            title: t("settings.general.browserData.confirmTitle"),
            message: t("settings.general.browserData.confirmMessage"),
            confirmLabel: t("settings.general.browserData.clear"),
            cancelLabel: t("common.actions.cancel"),
            destructive: true,
          }),
        clearProfile: getDesktopHost()?.browser?.clearProfile,
        browserIds: Object.keys(useBrowserStore.getState().browsersById),
      });
      if (result === "cleared") {
        toast.show(t("settings.general.browserData.success"), { variant: "success" });
      }
    } catch {
      toast.error(t("settings.general.browserData.error"));
    } finally {
      clearInFlightRef.current = false;
      setIsClearing(false);
    }
  }, [t, toast]);

  return (
    <SettingsSection title={t("settings.general.browserData.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.general.browserData.siteData")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.general.browserData.description")}
            </Text>
          </View>
          <Button
            variant="destructive"
            size="sm"
            loading={isClearing}
            disabled={isClearing}
            onPress={handleClear}
          >
            {isClearing
              ? t("settings.general.browserData.clearing")
              : t("settings.general.browserData.clear")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}
