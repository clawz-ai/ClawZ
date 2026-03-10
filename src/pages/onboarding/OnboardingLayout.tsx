import { Outlet } from "react-router";

export default function OnboardingLayout() {
  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden bg-[#141D28]">
      {/* Radial gradient overlay */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, rgba(26,82,118,0.13) 0%, transparent 100%)",
        }}
      />
      <Outlet />
    </div>
  );
}
