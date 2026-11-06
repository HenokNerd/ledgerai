import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Expand, FileImage, ExternalLink } from 'lucide-react';
import { api } from '../lib/api';

interface MarkdownViewProps {
  content: string;
  projectId?: string | null;
  filePath?: string;
  onImageOpen: (src: string, label: string) => void;
  onOpenFile?: (path: string) => void;
}

const imagePattern = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#].*)?$/i;
const markdownPattern = /\.md(?:[?#].*)?$/i;

function joinProjectPath(base: string, href: string): string | null {
  if (!href || href.startsWith('/') || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) return null;
  const stack = base.split('/').filter(Boolean).slice(0, -1);
  for (const part of href.split(/[?#]/, 1)[0].replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!stack.length) return null;
      stack.pop();
    } else stack.push(part);
  }
  return stack.join('/');
}

export default function MarkdownView({ content, projectId, filePath = '', onImageOpen, onOpenFile }: MarkdownViewProps) {
  const toUrl = (href: string) => {
    if (/^https?:\/\//i.test(href) || href.startsWith('/api/')) return href;
    if (!projectId) return href;
    const relative = joinProjectPath(filePath, href);
    return relative ? api.assetUrl(projectId, relative) : href;
  };

  return (
    <div className="markdown-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a({ href, children }) {
            const raw = href || '';
            const label = typeof children === 'string' ? children : raw.split('/').pop() || 'Image preview';
            const labeledImage = /\b(?:image|photo|screenshot|render|mockup|illustration)\b/i.test(String(label));
            if (imagePattern.test(raw) || (labeledImage && /^(?:https?:\/\/|\/api\/)/i.test(raw))) {
              const src = toUrl(raw);
              return (
                <button className="markdown-image-link" type="button" onClick={() => onImageOpen(src, String(label))}>
                  <img className="markdown-link-thumb" src={src} alt="" loading="lazy" />
                  <span className="markdown-link-copy"><strong><FileImage size={13} />{String(label)}</strong><small>Open image preview</small></span>
                  <Expand size={13} />
                </button>
              );
            }
            const localFile = projectId ? joinProjectPath(filePath, raw) : null;
            if (localFile && markdownPattern.test(localFile) && onOpenFile) {
              return <button className="markdown-file-link" type="button" onClick={() => onOpenFile(localFile)}><span className="md-link-icon">M↓</span>{children}</button>;
            }
            if (/^(?:https?:\/\/|mailto:|tel:)/i.test(raw)) return <a href={raw} target="_blank" rel="noreferrer noopener">{children}<ExternalLink size={12} className="external-link-icon" /></a>;
            return <span className="plain-link">{children}</span>;
          },
          img({ src, alt }) {
            if (!src) return null;
            const url = toUrl(src);
            return (
              <button className="markdown-image-preview" type="button" onClick={() => onImageOpen(url, alt || 'Image preview')} aria-label={`Open image: ${alt || 'preview'}`}>
                <img src={url} alt={alt || 'Image preview'} loading="lazy" />
                <span><Expand size={13} /> Open image</span>
              </button>
            );
          },
          pre({ children }) { return <pre>{children}</pre>; },
          code({ children, className }) { return <code className={className}>{children}</code>; },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
