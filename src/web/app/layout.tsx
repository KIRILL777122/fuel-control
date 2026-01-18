import Sidebar from "./components/Sidebar";
import AuthGuard from "./components/AuthGuard";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AuthGuard>
          <div style={{ display: "flex", minHeight: "100vh" }}>
            <Sidebar />
            <main 
              className="main-content"
              style={{ 
                marginLeft: 240, 
                flex: 1, 
                padding: 24, 
                fontFamily: "Arial"
              }}
            >
              {children}
            </main>
          </div>
        </AuthGuard>
      </body>
    </html>
  );
}
