#!/bin/bash
# Yoyoo Memory Backup/Restore Tool

set -e

MEMORY_DIR="$HOME/.openclaw/workspace"
BACKUP_DIR="$MEMORY_DIR/memory-backup"
BACKUP_FILE="$HOME/yoyoo-memory-backup.zip"

export_backup() {
    echo "📦 导出Yoyoo记忆..."
    
    # 创建备份目录
    mkdir -p "$BACKUP_DIR"
    
    # 复制核心记忆
    cp "$MEMORY_DIR/MEMORY.md" "$BACKUP_DIR/" 2>/dev/null || true
    
    # 复制日常记忆
    cp -r "$MEMORY_DIR/memory" "$BACKUP_DIR/" 2>/dev/null || true
    
    # 复制用户配置
    cp "$MEMORY_DIR/USER.md" "$BACKUP_DIR/" 2>/dev/null || true
    
    # 打包
    cd "$MEMORY_DIR"
    zip -r "$BACKUP_FILE" memory-backup
    
    echo "✅ 导出完成: $BACKUP_FILE"
    echo "   大小: $(du -h $BACKUP_FILE | cut -f1)"
}

import_backup() {
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "❌ 未找到备份文件: $BACKUP_FILE"
        exit 1
    fi
    
    echo "📥 导入Yoyoo记忆..."
    
    # 解压
    cd "$MEMORY_DIR"
    unzip -o "$BACKUP_FILE"
    
    # 恢复核心记忆
    cp -f "$BACKUP_DIR/MEMORY.md" "$MEMORY_DIR/" 2>/dev/null || true
    
    # 恢复日常记忆
    cp -rf "$BACKUP_DIR/memory/" "$MEMORY_DIR/" 2>/dev/null || true
    
    # 恢复用户配置
    cp -f "$BACKUP_DIR/USER.md" "$MEMORY_DIR/" 2>/dev/null || true
    
    echo "✅ 导入完成!"
    echo "   重启Gateway使生效: openclaw gateway restart"
}

case "$1" in
    export)
        export_backup
        ;;
    import)
        import_backup
        ;;
    *)
        echo "Yoyoo 记忆备份/恢复工具"
        echo ""
        echo "用法:"
        echo "  $0 export     # 导出记忆到备份文件"
        echo "  $0 import     # 从备份文件导入记忆"
        echo ""
        echo "备份位置: $BACKUP_FILE"
        ;;
esac
