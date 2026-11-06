import { useState } from 'react';
import {
  ChevronDown, ChevronRight, FileCode2, FileImage, FileJson2, FileText, FileType2,
  Folder, FolderOpen, Trash2, Braces, File,
} from 'lucide-react';
import type { FileNode } from '../types';

const iconColor: Record<string, string> = {
  ts: 'var(--icon-blue)', tsx: 'var(--icon-blue)', js: 'var(--icon-yellow)', jsx: 'var(--icon-yellow)',
  json: 'var(--icon-yellow)', md: 'var(--icon-cyan)', css: 'var(--icon-purple)', scss: 'var(--icon-pink)',
  html: 'var(--icon-orange)', py: 'var(--icon-blue)', go: 'var(--icon-cyan)', rs: 'var(--icon-orange)',
  svg: 'var(--icon-orange)', png: 'var(--icon-purple)', jpg: 'var(--icon-purple)', jpeg: 'var(--icon-purple)',
  yml: 'var(--icon-pink)', yaml: 'var(--icon-pink)', sh: 'var(--icon-green)', env: 'var(--icon-green)',
};

export function languageForPath(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', md: 'markdown',
    html: 'html', css: 'css', scss: 'scss', py: 'python', go: 'go', rs: 'rust', yml: 'yaml', yaml: 'yaml',
    sh: 'shell', sql: 'sql', xml: 'xml', svg: 'xml', java: 'java', c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php',
  };
  return languages[extension] || 'plaintext';
}

export function LanguageIcon({ path, size = 15 }: { path: string; size?: number }) {
  const ext = path.split('/').pop()?.split('.').pop()?.toLowerCase() || '';
  const style = { color: iconColor[ext] || 'var(--icon-muted)' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <FileImage size={size} style={style} />;
  if (['json', 'jsonc'].includes(ext)) return <FileJson2 size={size} style={style} />;
  if (['md', 'txt', 'mdx'].includes(ext)) return <FileText size={size} style={style} />;
  if (['css', 'scss', 'html', 'vue', 'svelte'].includes(ext)) return <FileType2 size={size} style={style} />;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp'].includes(ext)) return <FileCode2 size={size} style={style} />;
  if (['yaml', 'yml', 'toml'].includes(ext)) return <Braces size={size} style={style} />;
  return <File size={size} style={style} />;
}

interface FileTreeProps {
  nodes: FileNode[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onDelete: (node: FileNode) => void;
  onFolderFocus: (path: string) => void;
  onPreviewImage: (path: string) => void;
}

function TreeRow({ node, depth, activePath, onOpenFile, onDelete, onFolderFocus, onPreviewImage }: Omit<FileTreeProps, 'nodes'> & { node: FileNode; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const isDirectory = node.type === 'directory';
  const active = !isDirectory && activePath === node.path;
  const isImage = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(node.name);
  const activate = () => {
    if (isDirectory) {
      setOpen((current) => !current);
      onFolderFocus(node.path);
    } else if (isImage) onPreviewImage(node.path);
    else onOpenFile(node.path);
  };
  return (
    <div className="tree-node">
      <div className={`tree-row ${active ? 'active' : ''} ${isDirectory ? 'directory-row' : ''}`} style={{ paddingLeft: `${10 + depth * 15}px` }}>
        <button className="tree-item" type="button" onClick={activate} title={node.path}>
          {isDirectory ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="tree-chevron-spacer" />}
          {isDirectory ? (open ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={15} className="folder-icon" />) : <LanguageIcon path={node.name} />}
          <span className="tree-name">{node.name}</span>
        </button>
        <button className="tree-delete" type="button" aria-label={`Delete ${node.name}`} onClick={(event) => { event.stopPropagation(); onDelete(node); }}>
          <Trash2 size={13} />
        </button>
      </div>
      {isDirectory && open && (node.children || []).map((child) => (
        <TreeRow key={child.path} {...{ activePath, onOpenFile, onDelete, onFolderFocus, onPreviewImage }} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function FileTree(props: FileTreeProps) {
  if (!props.nodes.length) return <div className="tree-empty"><span>This project is empty.</span><small>Create a file or ask Ledger to start one.</small></div>;
  return <div className="file-tree" aria-label="Project files">{props.nodes.map((node) => <TreeRow key={node.path} {...props} node={node} depth={0} />)}</div>;
}
