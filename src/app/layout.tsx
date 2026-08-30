import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";

/* UI and headings. Grotesque with a slight warmth to it — not the default
   Inter/Space Grotesk pairing every dashboard reaches for. */
const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

/* Numbers, labels, code. Everything that lines up in a column. */
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

/* Note bodies only. Long-form reading is the one place a serif earns its
   keep in an otherwise sans interface. */
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Study Tracker",
  description: "Notes, subject mastery and LeetCode progress in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${instrument.variable} ${jetbrains.variable} ${newsreader.variable} antialiased`}
      >
        <div className="grid min-h-screen grid-cols-1 md:grid-cols-[236px_minmax(0,1fr)]">
          <Nav />
          <main className="min-w-0 px-5 pb-28 pt-6 md:px-10 md:pb-16 md:pt-9">
            <div className="mx-auto flex max-w-[1120px] flex-col gap-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
