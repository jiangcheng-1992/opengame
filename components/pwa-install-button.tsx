"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as StandaloneNavigator).standalone)
  );
}

function apkDownloadUrl() {
  const configured = process.env.NEXT_PUBLIC_ANDROID_APK_URL?.trim();
  return configured || "/downloads/opengame.apk";
}

function hasConfiguredApkUrl() {
  return Boolean(process.env.NEXT_PUBLIC_ANDROID_APK_URL?.trim());
}

export function PwaInstallButton() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [hasApkDownload, setHasApkDownload] = useState(false);
  const apkUrl = apkDownloadUrl();
  const configuredApkUrl = hasConfiguredApkUrl();

  useEffect(() => {
    setIsStandalone(isStandaloneApp());
    if (configuredApkUrl) {
      setHasApkDownload(true);
      return;
    }
    if (apkUrl) {
      fetch(apkUrl, { method: "HEAD", cache: "no-store" })
        .then((response) => setHasApkDownload(response.ok))
        .catch(() => setHasApkDownload(false));
    }

    const handlePrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setPromptEvent(null);
      setIsStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [apkUrl, configuredApkUrl]);

  if (hasApkDownload) {
    return (
      <a className="install-app-button" href={apkUrl} download aria-label="下载 OpenGame 安卓 APK">
        <Download size={17} aria-hidden />
        <span className="install-app-label">安装</span>
      </a>
    );
  }

  if (isStandalone || !promptEvent) return null;

  const handleInstall = async () => {
    const event = promptEvent;
    setPromptEvent(null);
    await event.prompt();
    await event.userChoice.catch(() => undefined);
  };

  return (
    <button type="button" className="install-app-button" onClick={handleInstall} aria-label="安装 OpenGame App">
      <Download size={17} aria-hidden />
      <span className="install-app-label">安装</span>
    </button>
  );
}
