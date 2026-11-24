import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCardImage } from "../../../hooks/useCardImage.ts";
import { useGameStore } from "../../../stores/gameStore.ts";
import { CardCoverageDashboard } from "../../controls/CardCoverageDashboard.tsx";
import { CardTextboxPreview } from "../../modal/CardTextboxPreview.tsx";

vi.mock("../../../hooks/useCardImage.ts", () => ({ useCardImage: vi.fn() }));
vi.mock("../../../hooks/useCardHover.ts", () => ({
  useCardHover: vi.fn(() => ({ handlers: {}, firedRef: { current: false } })),
}));
vi.mock("../../../hooks/useEngineCardData.ts", () => ({
  useCardParseDetails: vi.fn(() => []),
}));

const mockUseCardImage = vi.mocked(useCardImage);

beforeEach(() => {
  useGameStore.setState({ gameState: null, gameMode: "local" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("visual-pack visible previews", () => {
  it("keeps normal rungs coupled and advances the exact textbox source", () => {
    const advanceFailedSource = vi.fn();
    mockUseCardImage.mockReturnValue({
      src: "installed-normal.png",
      isLoading: false,
      isRotated: false,
      isFlip: false,
      rungs: { small: "installed-small.png", normal: "installed-normal.png" },
      advanceFailedSource,
    });

    render(<CardTextboxPreview cardName="Public rules" />);
    const image = document.querySelector("img");
    expect(image).toHaveAttribute(
      "srcset",
      "installed-small.png 146w, installed-normal.png 488w",
    );
    fireEvent.error(image!);
    expect(advanceFailedSource).toHaveBeenCalledWith("installed-normal.png");
  });

  it("retains the public name after settled exhaustion", () => {
    mockUseCardImage.mockReturnValue({
      src: null,
      isLoading: false,
      isRotated: false,
      isFlip: false,
    });

    render(<CardTextboxPreview cardName="Public rules" />);
    expect(screen.getByRole("img", { name: "Public rules" })).toHaveTextContent("Public rules");
  });

  it("renders coverage rungs", async () => {
    vi.stubGlobal("__COVERAGE_DATA_URL__", "/coverage.json");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        total_cards: 1,
        supported_cards: 1,
        coverage_pct: 100,
        cards: [{
          card_name: "Coverage Card",
          set_code: "TST",
          supported: true,
          oracle_text: "Public rules",
          parse_details: [],
        }],
      }),
    })));
    const advanceFailedSource = vi.fn();
    mockUseCardImage.mockReturnValue({
      src: "coverage-normal.png",
      isLoading: false,
      isRotated: false,
      isFlip: false,
      rungs: { small: "coverage-small.png", normal: "coverage-normal.png" },
      advanceFailedSource,
    });

    render(<CardCoverageDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /Coverage Card/i }));
    const image = await screen.findByRole("img", { name: "Coverage Card" });
    expect(image).toHaveAttribute(
      "srcset",
      "coverage-small.png 146w, coverage-normal.png 488w",
    );
    fireEvent.error(image);
    expect(advanceFailedSource).toHaveBeenCalledWith("coverage-normal.png");

  });
});
