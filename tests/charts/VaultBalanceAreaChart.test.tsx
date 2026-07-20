import React from "react";
import { render, screen } from "@testing-library/react";
import { VaultBalanceAreaChart } from "@/charts/VaultBalanceAreaChart";
import { ThemeProvider } from "@/contexts/ThemeContext";

const sampleData = [
  { timestamp: 1000, date: "Jan 1", value: 100 },
  { timestamp: 2000, date: "Jan 2", value: 200 },
  { timestamp: 3000, date: "Jan 3", value: 150 },
];

describe("VaultBalanceAreaChart", () => {
  function renderChart(props = {}) {
    return render(
      <ThemeProvider>
        <VaultBalanceAreaChart data={sampleData} title="Vault Balance" {...props} />
      </ThemeProvider>
    );
  }

  it("renders the chart with aria-label containing the title", () => {
    renderChart();
    expect(screen.getByRole("img", { name: /Vault Balance/ })).toBeInTheDocument();
  });

  it("renders as an accessible image with aria-label", () => {
    renderChart({
      description: "Balance history for the vault over the last 30 days",
    });
    expect(
      screen.getByRole("img", {
        name: "Vault Balance: Balance history for the vault over the last 30 days",
      }),
    ).toBeInTheDocument();
  });

  it("renders empty state when data is empty", () => {
    renderChart({ data: [] });
    expect(screen.getByText("No balance data available")).toBeInTheDocument();
  });

  it("renders loading skeleton when isLoading is true", () => {
    const { container } = renderChart({ isLoading: true });
    // ChartSkeleton renders an animated div
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders the chart without error when showAverage is true (default)", () => {
    renderChart();
    // Recharts may not render SVG <text> labels in jsdom; verify the chart
    // renders successfully with the accessible container present.
    expect(screen.getByRole("img", { name: /Vault Balance/ })).toBeInTheDocument();
  });

  it("renders the chart without error when showAverage is false", () => {
    renderChart({ showAverage: false });
    expect(screen.getByRole("img", { name: /Vault Balance/ })).toBeInTheDocument();
  });

  it("renders without grid when showGrid is false", () => {
    renderChart({ showGrid: false });
    // ChartWrapper should still render the accessible image
    expect(screen.getByRole("img", { name: /Vault Balance/ })).toBeInTheDocument();
  });

  it("applies custom className", () => {
    renderChart({ className: "my-custom-class" });
    const wrapper = screen.getByRole("img", { name: /Vault Balance/ });
    expect(wrapper.className).toContain("my-custom-class");
  });
});
