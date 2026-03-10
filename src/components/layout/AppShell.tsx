import { Outlet, useLocation } from "react-router";
import Sidebar from "./Sidebar";

export default function AppShell() {
  const location = useLocation();

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-[var(--bg-surface)]">
        <div key={location.pathname} className="page-enter h-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
