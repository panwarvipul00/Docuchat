import { AppShell } from "@/components/AppShell";
import { ChatSidebar, ConversationsProvider } from "@/components/ChatSidebar";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell fullWidth>
      <ConversationsProvider>
        {/* 4rem = the sticky top nav; dvh keeps the composer above mobile browser bars. */}
        <div className="flex h-[calc(100dvh-4rem)]">
          <ChatSidebar />
          <section className="flex min-w-0 flex-1 flex-col">{children}</section>
        </div>
      </ConversationsProvider>
    </AppShell>
  );
}
