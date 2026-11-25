import { useState } from "react";
import { ThemeProvider } from "@/theme/ThemeContext";
import { NavigationRail } from "@/components/m3/NavigationRail";
import { TopAppBar } from "@/components/m3/TopAppBar";
import { InstancesView } from "@/components/instances/InstancesView";
import { EnvStudioView } from "@/components/env/EnvStudioView";
import { ReleasesView } from "@/components/releases/ReleasesView";
import { SshView } from "@/components/ssh/SshView";
import {
  Server,
  SlidersHorizontal,
  PackageCheck,
  Terminal,
} from "lucide-react";
import "./index.css";

type NavId = "instances" | "env" | "releases" | "ssh";

const NAV_ITEMS = [
  { id: "instances" as NavId, label: "Instances", icon: Server },
  { id: "env" as NavId, label: "Env Studio", icon: SlidersHorizontal },
  { id: "releases" as NavId, label: "Releases", icon: PackageCheck },
  { id: "ssh" as NavId, label: "SSH", icon: Terminal },
];

const VIEW_TITLES: Record<NavId, { title: string; subtitle: string }> = {
  instances: { title: "Instances", subtitle: "Manage Gradebook deployments" },
  env: { title: "Env Studio", subtitle: "Configure environment variables" },
  releases: { title: "Releases", subtitle: "Browse & upgrade Gradebook versions" },
  ssh: { title: "SSH Manager", subtitle: "Connect to remote instances" },
};

export default function App() {
  const [active, setActive] = useState<NavId>("instances");
  const meta = VIEW_TITLES[active];

  return (
    <ThemeProvider>
      <div className="flex h-screen overflow-hidden bg-[var(--md-sys-color-background)] text-[var(--md-sys-color-on-background)]">
        {/* Navigation Rail */}
        <NavigationRail
          items={NAV_ITEMS.map((item) => ({
            id: item.id,
            label: item.label,
            icon: <item.icon size={20} />,
          }))}
          activeId={active}
          onSelect={(id) => setActive(id as NavId)}
        />

        {/* Main content area */}
        <div className="flex flex-col flex-1 min-w-0">
          <TopAppBar title={meta.title} subtitle={meta.subtitle} />

          <main className="flex-1 overflow-y-auto p-6">
            {active === "instances" && <InstancesView />}
            {active === "env" && <EnvStudioView />}
            {active === "releases" && <ReleasesView />}
            {active === "ssh" && <SshView />}
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
}
