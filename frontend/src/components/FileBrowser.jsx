import React, { useState, useEffect } from 'react'
import { Folder, File, ChevronRight, ChevronDown, ChevronLeft, Check } from 'lucide-react'
import Button from './ui/Button'
import { browseFiles } from '../lib/api'

const TreeItem = ({ 
  item, 
  depth, 
  isSelected, 
  isExpanded, 
  onToggleExpand, 
  onToggleSelect, 
  multiSelect, 
  formatSize,
  childItems,
  expandedDirs,
  selectedPaths,
  toggleExpand,
  toggleSelection,
  allChildItems
}) => {
  return (
    <>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent transition-colors cursor-pointer ${
          isSelected ? 'bg-primary/10 border border-primary' : ''
        }`}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        {multiSelect && (
          <div 
            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
              isSelected ? 'bg-primary border-primary' : 'border-input'
            }`}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect()
            }}
          >
            {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
          </div>
        )}
        
        {item.type === 'directory' ? (
          <div 
            className="flex items-center gap-2 flex-1"
            onClick={onToggleExpand}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <Folder className="h-4 w-4 text-blue-500 flex-shrink-0" />
            <span className="text-sm truncate">{item.name}</span>
          </div>
        ) : (
          <div 
            className="flex items-center gap-2 flex-1 ml-5"
            onClick={onToggleSelect}
          >
            <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="text-sm truncate flex-1">{item.name}</span>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatSize(item.size)}
            </span>
          </div>
        )}
      </div>
      
      {/* Render children if expanded */}
      {isExpanded && childItems && childItems.map((child) => (
        <TreeItem
          key={child.path}
          item={child}
          depth={depth + 1}
          isSelected={selectedPaths.includes(child.path)}
          isExpanded={expandedDirs.has(child.path)}
          onToggleExpand={() => toggleExpand(child.path)}
          onToggleSelect={() => toggleSelection(child.path)}
          multiSelect={multiSelect}
          formatSize={formatSize}
          childItems={allChildItems[child.path]}
          expandedDirs={expandedDirs}
          selectedPaths={selectedPaths}
          toggleExpand={toggleExpand}
          toggleSelection={toggleSelection}
          allChildItems={allChildItems}
        />
      ))}
    </>
  )
}

const FileBrowser = ({ onSelect, onClose, multiSelect = true, initialSelected = [] }) => {
  // Pre-populate selection from previously chosen paths so the user can add to
  // an existing list instead of starting from scratch every time.
  const initial = Array.isArray(initialSelected)
    ? initialSelected.filter(Boolean)
    : (initialSelected ? String(initialSelected).split(',').map(s => s.trim()).filter(Boolean) : [])

  // Pick an initial directory that's most likely useful: the parent of the
  // first existing selection, falling back to /data.
  const initialDir = (() => {
    if (initial.length === 0) return '/data'
    const first = initial[0]
    const idx = first.lastIndexOf('/')
    if (idx <= 0) return '/'
    return first.slice(0, idx) || '/'
  })()

  const [currentPath, setCurrentPath] = useState(initialDir)
  const [items, setItems] = useState([])
  const [selectedPaths, setSelectedPaths] = useState(initial)
  const [loading, setLoading] = useState(false)
  const [parentPath, setParentPath] = useState(null)
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [childItems, setChildItems] = useState({}) // Cache for expanded directories

  useEffect(() => {
    loadDirectory(currentPath)
  }, [currentPath])

  const loadDirectory = async (path) => {
    setLoading(true)
    try {
      const response = await browseFiles(path)
      setItems(response.data.items || [])
      setParentPath(response.data.parent_path)
    } catch (error) {
      console.error('Failed to load directory:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = async (dirPath) => {
    const newExpanded = new Set(expandedDirs)
    if (newExpanded.has(dirPath)) {
      newExpanded.delete(dirPath)
    } else {
      newExpanded.add(dirPath)
      // Load children if not cached
      if (!childItems[dirPath]) {
        try {
          const response = await browseFiles(dirPath)
          setChildItems(prev => ({ ...prev, [dirPath]: response.data.items || [] }))
        } catch (error) {
          console.error('Failed to load directory:', error)
        }
      }
    }
    setExpandedDirs(newExpanded)
  }

  const handleItemClick = (item, isCheckbox = false) => {
    if (isCheckbox) {
      toggleSelection(item.path)
    } else if (item.type === 'directory') {
      toggleExpand(item.path)
    } else {
      toggleSelection(item.path)
    }
  }

  const toggleSelection = (path) => {
    if (multiSelect) {
      setSelectedPaths(prev => 
        prev.includes(path) 
          ? prev.filter(p => p !== path)
          : [...prev, path]
      )
    } else {
      setSelectedPaths([path])
    }
  }

  const selectAll = () => {
    const allPaths = items.map(item => item.path)
    setSelectedPaths(allPaths)
  }

  const clearSelection = () => {
    setSelectedPaths([])
  }

  const handleConfirm = () => {
    if (multiSelect) {
      onSelect(selectedPaths)
    } else {
      onSelect(selectedPaths[0] || currentPath)
    }
    onClose()
  }

  const formatSize = (bytes) => {
    if (bytes === 0) return '-'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background border rounded-lg w-full max-w-3xl max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            <span className="font-medium">Select Files/Folders</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="p-3 border-b bg-muted/30">
          <div className="flex items-center gap-2">
            {parentPath && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentPath(parentPath)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <code className="text-sm flex-1 px-2 py-1 bg-background rounded">
              {currentPath}
            </code>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">Empty directory</div>
          ) : (
            <div className="space-y-0.5">
              {items.map((item) => (
                <TreeItem 
                  key={item.path} 
                  item={item} 
                  depth={0}
                  isSelected={selectedPaths.includes(item.path)}
                  isExpanded={expandedDirs.has(item.path)}
                  onToggleExpand={() => toggleExpand(item.path)}
                  onToggleSelect={() => toggleSelection(item.path)}
                  multiSelect={multiSelect}
                  formatSize={formatSize}
                  childItems={childItems[item.path]}
                  expandedDirs={expandedDirs}
                  selectedPaths={selectedPaths}
                  toggleExpand={toggleExpand}
                  toggleSelection={toggleSelection}
                  allChildItems={childItems}
                />
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-muted-foreground">
              {selectedPaths.length > 0 ? (
                <span className="font-medium text-primary">{selectedPaths.length} selected</span>
              ) : (
                <span>No items selected</span>
              )}
            </div>
            {multiSelect && items.length > 0 && (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={clearSelection} disabled={selectedPaths.length === 0}>
                  Clear
                </Button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={selectedPaths.length === 0} className="flex-1">
              Confirm ({selectedPaths.length})
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FileBrowser
