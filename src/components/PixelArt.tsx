/** Original, hand-drawn manual illustrations. Integer geometry; no external artwork. */
export function PixelArt({
  kind = "computer",
  className = "",
}: {
  kind?: "computer" | "bulb" | "disk" | "window" | "crane";
  className?: string;
}) {
  return (
    <svg
      className={"pixel-art " + className}
      viewBox="0 0 128 112"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {kind === "computer" && (
        <>
          <path d="M24 12h72v4h4v56h-4v4H24v-4h-4V16h4z" fill="currentColor" />
          <path d="M28 20h64v44H28z" fill="var(--navy)" />
          <path d="M34 26h52v32H34z" stroke="var(--cyan)" strokeWidth="2" />
          <path
            d="M44 34h8v4h4v4h-4v4h-8m16 0h12"
            stroke="var(--paper)"
            strokeWidth="4"
          />
          <path
            d="M54 76h16v12H54zM42 88h40v4H42zM18 94h88v4h4v10H14V98h4z"
            fill="currentColor"
          />
          <path
            d="M22 100h8m4 0h8m4 0h8m4 0h8m4 0h8m4 0h8"
            stroke="var(--navy)"
            strokeWidth="2"
          />
          <path d="M86 70h6" stroke="var(--navy)" strokeWidth="2" />
          <path
            d="M8 30H0m4-4v8m112 32h12m-6-6v12"
            stroke="var(--cyan)"
            strokeWidth="2"
          />
        </>
      )}
      {kind === "bulb" && (
        <>
          <path
            d="M44 20h40v4h8v8h4v28h-4v8h-8v12H44V68h-8v-8h-4V32h4v-8h8z"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            d="M48 88h32m-28 8h24m-20 8h16M56 80V56l-8-8m24 32V56l8-8M64 0v10M16 12l8 8m88-8-8 8M8 48h12m88 0h12"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path d="M44 36h8v-4h20" stroke="var(--cyan)" strokeWidth="4" />
        </>
      )}
      {kind === "disk" && (
        <>
          <path d="M24 8h68l12 12v84H20V12h4z" fill="currentColor" />
          <path d="M40 8h44v36H40zM36 64h52v40H36z" fill="var(--navy)" />
          <path
            d="M68 14h10v24H68zM42 72h40m-40 8h40m-40 8h28"
            stroke="var(--cyan)"
            strokeWidth="3"
          />
          <path d="M26 92h4m64 0h4" stroke="var(--navy)" strokeWidth="4" />
        </>
      )}
      {kind === "window" && (
        <>
          <path
            d="M10 16h108v80H10zM10 34h108"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            d="M18 24h4m4 0h4m4 0h4m62 0h10M26 50h30v28H26zM68 50h32m-32 12h24m-24 12h18"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            d="M30 82h22M64 92h20v-8h12v16h-8v8h-8v-8H64z"
            fill="var(--cyan)"
          />
        </>
      )}
      {kind === "crane" && (
        <>
          <path
            d="M28 104V12h12v92M18 104h32M8 20h108v12H8zM34 12l68 8M40 32l-12 16 12 16-12 16 12 16M96 32v30h-8v8h16v-8"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            d="M68 82h44v26H68zM68 90h44M76 86h4m4 0h4m12 12h6"
            stroke="var(--cyan)"
            strokeWidth="3"
          />
        </>
      )}
    </svg>
  );
}
export function BlueprintStamp({
  children = "ALREADY BUILT",
}: {
  children?: string;
}) {
  return (
    <span className="blueprint-stamp">
      {children}
      <span aria-hidden="true">▦</span>
    </span>
  );
}
