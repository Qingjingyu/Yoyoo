import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { twMerge } from "tailwind-merge";
import Icon from "@/components/Icon";
import { useLocale } from "@/contexts/locale-context";
import { chatHistory } from "@/mocks/chatHistory";
import {
    CHAT_STATE_PATCHED_EVENT,
    createConversationUrl,
    CHAT_STATE_STORAGE_KEY,
    fetchConversationStateMapFromServer,
    persistConversationStateMapToServer,
    readConversationStateMap,
    removeConversationMessages,
    removeConversationMessagesFromServer,
} from "@/lib/chat-storage";
import { PersistedConversationState } from "@/lib/chat-types";

type ChatListType = {
    id: string;
    title: string;
    counter: number;
    color: string;
    url: string;
};

type ChatListProps = {
    visible?: boolean;
    items: ChatListType[];
};

type ConversationItem = {
    id: string;
    title: string;
    url: string;
    updatedAt: number;
    pinned: boolean;
    counter?: number;
};

const ChatList = ({ visible, items }: ChatListProps) => {
    const { t } = useLocale();
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const normalizeText = (text: string) => text.trim();
    const activeConv = decodeURIComponent(searchParams.get("conv") || "/");

    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState<string>("");
    const [persistedState, setPersistedState] = useState<
        Record<string, PersistedConversationState>
    >({});
    const [storageLoaded, setStorageLoaded] = useState<boolean>(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const syncTimerRef = useRef<number | null>(null);

    const defaultConversations = useMemo<ConversationItem[]>(() => {
        const pinnedUrls = new Set<string>(["/", "/education-feedback"]);
        const recencyRank: Record<string, number> = {
            "/": 100,
            "/education-feedback": 95,
            "/code-generation": 90,
            "/photo-editing": 80,
            "/audio-generation": 70,
            "/generation-socials-post": 60,
        };

        const fromList = items.map((item) => ({
            id: `list-${item.id}`,
            title: normalizeText(t(`chatList.item.${item.id}.title`)),
            url: item.url,
            counter: item.counter,
            updatedAt: recencyRank[item.url] ?? 10,
            pinned: pinnedUrls.has(item.url),
        }));

        const fromHistory = chatHistory.map((item) => ({
            id: `history-${item.id}`,
            title: normalizeText(t(`chatHistory.item.${item.id}.title`)),
            url: item.url,
            updatedAt: recencyRank[item.url] ?? 10,
            pinned: pinnedUrls.has(item.url),
        }));

        const map = new Map<string, ConversationItem>();
        [...fromList, ...fromHistory].forEach((item) => {
            const current = map.get(item.url);
            if (!current || item.updatedAt > current.updatedAt) {
                map.set(item.url, item);
            }
        });

        return Array.from(map.values());
    }, [items, t]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const mergeByUpdatedAt = (
            local: Record<string, PersistedConversationState>,
            remote: Record<string, PersistedConversationState>
        ) => {
            const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
            const merged: Record<string, PersistedConversationState> = {};
            keys.forEach((key) => {
                const localState = local[key];
                const remoteState = remote[key];
                if (!localState) {
                    merged[key] = remoteState;
                    return;
                }
                if (!remoteState) {
                    merged[key] = localState;
                    return;
                }
                merged[key] =
                    (remoteState.updatedAt ?? 0) > (localState.updatedAt ?? 0)
                        ? remoteState
                        : localState;
            });
            return merged;
        };

        try {
            const local = readConversationStateMap();
            setPersistedState(local);
            fetchConversationStateMapFromServer()
                .then((remote) => {
                    setPersistedState((prev) => mergeByUpdatedAt(prev, remote));
                })
                .catch(() => null);
        } catch {
            setPersistedState({});
        } finally {
            setStorageLoaded(true);
        }
    }, []);

    useEffect(() => {
        if (!storageLoaded || typeof window === "undefined") return;
        window.localStorage.setItem(
            CHAT_STATE_STORAGE_KEY,
            JSON.stringify(persistedState)
        );
        if (syncTimerRef.current) {
            window.clearTimeout(syncTimerRef.current);
        }
        syncTimerRef.current = window.setTimeout(() => {
            persistConversationStateMapToServer(persistedState).catch(() => null);
        }, 250);
    }, [persistedState, storageLoaded]);

    useEffect(() => {
        const onStatePatched = () => {
            setPersistedState(readConversationStateMap());
        };
        window.addEventListener(CHAT_STATE_PATCHED_EVENT, onStatePatched);
        return () => {
            window.removeEventListener(CHAT_STATE_PATCHED_EVENT, onStatePatched);
        };
    }, []);

    useEffect(() => {
        if (!menuOpenId) return;
        const onDocumentClick = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!rootRef.current?.contains(target)) {
                setMenuOpenId(null);
            }
        };
        document.addEventListener("mousedown", onDocumentClick);
        return () => document.removeEventListener("mousedown", onDocumentClick);
    }, [menuOpenId]);

    const sortedConversations = useMemo(() => {
        const defaultUrls = new Set(defaultConversations.map((item) => item.url));

        const customConversations = Object.entries(persistedState)
            .filter(
                ([url, state]) => !defaultUrls.has(url) && !state.deleted
            )
            .map(([url, state]) => ({
                id: `custom-${url}`,
                title:
                    state.title ||
                    normalizeText(t("rightSidebar.newChat")),
                url,
                updatedAt: state.updatedAt ?? 0,
                pinned: state.pinned ?? false,
            }));

        const merged = [...defaultConversations, ...customConversations]
            .map((item) => {
                const persisted = persistedState[item.url];
                if (persisted?.deleted) return null;
                return {
                    ...item,
                    title: persisted?.title ?? item.title,
                    pinned: persisted?.pinned ?? item.pinned,
                    updatedAt: persisted?.updatedAt ?? item.updatedAt,
                };
            })
            .filter(Boolean) as ConversationItem[];

        return merged.sort((a, b) => {
            if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
            return b.updatedAt - a.updatedAt;
        });
    }, [defaultConversations, persistedState, t]);

    const patchPersisted = (
        url: string,
        patch: Partial<PersistedConversationState>
    ) => {
        setPersistedState((prev) => ({
            ...prev,
            [url]: {
                ...(prev[url] ?? {}),
                ...patch,
            },
        }));
    };

    const handleTogglePin = (item: ConversationItem) => {
        patchPersisted(item.url, {
            pinned: !item.pinned,
            deleted: false,
        });
        setMenuOpenId(null);
    };

    const handleDelete = (item: ConversationItem) => {
        patchPersisted(item.url, {
            deleted: true,
        });
        removeConversationMessages(item.url);
        removeConversationMessagesFromServer(item.url).catch(() => null);
        setMenuOpenId(null);
        if (editingId === item.id) {
            setEditingId(null);
            setEditingTitle("");
        }
        if (activeConv === item.url) {
            router.push("/?conv=/");
        }
    };

    const startRename = (item: ConversationItem) => {
        setEditingId(item.id);
        setEditingTitle(item.title);
        setMenuOpenId(null);
    };

    const commitRename = () => {
        if (!editingId) return;
        const current = sortedConversations.find((item) => item.id === editingId);
        if (!current) {
            setEditingId(null);
            setEditingTitle("");
            return;
        }
        const nextTitle = editingTitle.trim();
        if (nextTitle) {
            patchPersisted(current.url, {
                title: nextTitle,
                deleted: false,
            });
        }
        setEditingId(null);
        setEditingTitle("");
    };

    const handleCreateNewConversation = () => {
        const newUrl = createConversationUrl();
        patchPersisted(newUrl, {
            title: normalizeText(t("rightSidebar.newChat")),
            updatedAt: Date.now(),
            pinned: false,
            deleted: false,
        });
        router.push(`/?conv=${encodeURIComponent(newUrl)}`);
    };

    return (
        <div className="mb-auto pb-6" ref={rootRef}>
            <button
                type="button"
                className={twMerge(
                    `flex items-center w-full h-12 rounded-lg base2 font-semibold text-n-3/75 transition-colors hover:text-n-1 ${
                        visible ? "justify-center px-3" : "px-5"
                    } ${
                        pathname === "/" && activeConv === "/"
                            ? "text-n-1 bg-gradient-to-l from-[#323337] to-[rgba(70,79,111,0.3)] shadow-[inset_0px_0.0625rem_0_rgba(255,255,255,0.05),0_0.25rem_0.5rem_0_rgba(0,0,0,0.1)]"
                            : ""
                    }`
                )}
                onClick={handleCreateNewConversation}
            >
                <Icon className="fill-primary-2" name="plus-circle" />
                {!visible && (
                    <div className="ml-5" suppressHydrationWarning>
                        {normalizeText(t("rightSidebar.newChat"))}
                    </div>
                )}
            </button>

            <div className={twMerge("mt-2", visible ? "px-2" : "")}>
                {sortedConversations.map((item) => {
                    const active = pathname === "/" && activeConv === item.url;
                    const isEditing = editingId === item.id;
                    const showMenu = menuOpenId === item.id;
                    return (
                        <div
                            key={item.id}
                            className={twMerge(
                                `group relative flex items-center w-full h-11 rounded-lg transition-colors ${
                                    active &&
                                    "bg-gradient-to-l from-[#323337] to-[rgba(80,62,110,0.29)]"
                                }`
                            )}
                        >
                            <Link
                                className={twMerge(
                                    `flex items-center h-11 text-n-3/75 base2 font-semibold transition-colors hover:text-n-1 ${
                                        visible
                                            ? "w-full px-3 justify-center"
                                            : "flex-1 pl-5 pr-2"
                                    } ${active && "text-n-1"}`
                                )}
                                href={`/?conv=${encodeURIComponent(item.url)}`}
                            >
                                <Icon
                                    className={twMerge(
                                        "fill-n-4 transition-colors group-hover:fill-n-1",
                                        item.pinned && "fill-accent-4"
                                    )}
                                    name={item.pinned ? "star" : "chat-1"}
                                />
                                {!visible && (
                                    <>
                                        <div className="ml-5 min-w-0 flex-1">
                                            {isEditing ? (
                                                <input
                                                    className="w-full h-7 px-2 rounded bg-n-6 text-n-1 outline-none border border-primary-1"
                                                    value={editingTitle}
                                                    onChange={(event) =>
                                                        setEditingTitle(
                                                            event.target.value
                                                        )
                                                    }
                                                    onBlur={commitRename}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter")
                                                            commitRename();
                                                        if (event.key === "Escape") {
                                                            setEditingId(null);
                                                            setEditingTitle("");
                                                        }
                                                    }}
                                                    autoFocus
                                                />
                                            ) : (
                                                <div
                                                    className="truncate"
                                                    onDoubleClick={(event) => {
                                                        event.preventDefault();
                                                        startRename(item);
                                                    }}
                                                >
                                                    <span suppressHydrationWarning>
                                                        {item.title}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        {!!item.counter && (
                                            <div className="ml-2 px-2 bg-n-6 rounded-lg caption1 font-semibold text-n-4">
                                                {item.counter}
                                            </div>
                                        )}
                                    </>
                                )}
                            </Link>

                            {!visible && (
                                <div className="relative pr-2">
                                    <button
                                        className="w-8 h-8 rounded-md text-n-4 hover:text-n-1 hover:bg-n-6 opacity-0 group-hover:opacity-100 transition"
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setMenuOpenId(
                                                showMenu ? null : item.id
                                            );
                                        }}
                                    >
                                        <Icon name="dots" />
                                    </button>
                                    {showMenu && (
                                        <div className="absolute right-0 top-9 z-20 w-36 rounded-lg border border-n-4/20 bg-n-7 p-1 shadow-2xl">
                                            <button
                                                className="w-full h-8 px-3 rounded text-left caption1 text-n-2 hover:bg-n-6"
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    startRename(item);
                                                }}
                                            >
                                                {normalizeText(
                                                    t("chatList.action.rename")
                                                )}
                                            </button>
                                            <button
                                                className="w-full h-8 px-3 rounded text-left caption1 text-n-2 hover:bg-n-6"
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    handleTogglePin(item);
                                                }}
                                            >
                                                {normalizeText(
                                                    t(
                                                        item.pinned
                                                            ? "chatList.action.unpin"
                                                            : "chatList.action.pin"
                                                    )
                                                )}
                                            </button>
                                            <button
                                                className="w-full h-8 px-3 rounded text-left caption1 text-accent-1 hover:bg-n-6"
                                                onClick={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    handleDelete(item);
                                                }}
                                            >
                                                {normalizeText(
                                                    t("chatList.action.delete")
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ChatList;
