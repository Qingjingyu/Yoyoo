import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#0d1412",
          border: "1px solid #2b4037",
          borderRadius: "50%",
          color: "#a3ddc0",
          display: "flex",
          fontFamily: "sans-serif",
          fontSize: 17,
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        Y
      </div>
    ),
    size,
  );
}
