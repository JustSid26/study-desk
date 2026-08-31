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
      <head>
        {/*
          Size the rail before first paint. Without this the server renders an
          open rail, the client reads localStorage a frame later, and a
          collapsed rail visibly snaps shut on every navigation.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var r=localStorage.getItem('study-tracker.rail');" +
              "document.documentElement.setAttribute('data-rail',r==='collapsed'?'collapsed':'open')}" +
              "catch(e){document.documentElement.setAttribute('data-rail','open')}",
          }}
        />
      </head>
      <body
        className={`${instrument.variable} ${jetbrains.variable} ${newsreader.variable} antialiased`}
      >
        <div className="app-shell grid min-h-screen">
          <Nav />
          {/* Bare on purpose. The padded, centred column lives in the (app)
              route group's layout, so Practice can fill the window instead. */}
          <main className="min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
