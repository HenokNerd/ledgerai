import {
  Atom, BarChart3, BookOpen, Bookmark, Bot, Brain, Briefcase, Bug, Building2, Calendar,
  Camera, Clapperboard, Cloud, Code2, Coffee, Compass, Cpu, CreditCard, Database, Dna,
  DollarSign, Earth, FileCode2, Fingerprint, FlaskConical, Gamepad2, Gauge, GitBranch, Globe,
  GraduationCap, Handshake, Headphones, HeartPulse, House, KeyRound, Layers, LayoutDashboard,
  Leaf, Lightbulb, Lock, Mail, MapPin, Megaphone, MessageSquareText, Microscope, Monitor, Music,
  Network, Package, Paintbrush, Palette, PenTool, PieChart, Plane, Presentation, Puzzle, Rocket,
  Scale, Search, Server, Settings, Shield, ShieldCheck, ShoppingCart, Smartphone, Sparkles, Store,
  Target, Terminal, TestTube2, Timer, TrendingUp, Truck, Trophy, User, Users, Video, Wallet,
  Wand2, Webhook, Wifi, Workflow, Wrench, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// Keep this map in sync with CHAT_ICONS in server/chats.mjs.
const CHAT_ICONS: Record<string, LucideIcon> = {
  Atom, BarChart3, BookOpen, Bookmark, Bot, Brain, Briefcase, Bug, Building2, Calendar,
  Camera, Clapperboard, Cloud, Code2, Coffee, Compass, Cpu, CreditCard, Database, Dna,
  DollarSign, Earth, FileCode2, Fingerprint, FlaskConical, Gamepad2, Gauge, GitBranch, Globe,
  GraduationCap, Handshake, Headphones, HeartPulse, House, KeyRound, Layers, LayoutDashboard,
  Leaf, Lightbulb, Lock, Mail, MapPin, Megaphone, MessageSquareText, Microscope, Monitor, Music,
  Network, Package, Paintbrush, Palette, PenTool, PieChart, Plane, Presentation, Puzzle, Rocket,
  Scale, Search, Server, Settings, Shield, ShieldCheck, ShoppingCart, Smartphone, Sparkles, Store,
  Target, Terminal, TestTube2, Timer, TrendingUp, Truck, Trophy, User, Users, Video, Wallet,
  Wand2, Webhook, Wifi, Workflow, Wrench, Zap,
};

export function ChatIcon({ name, size = 15, className }: { name: string; size?: number; className?: string }) {
  const Icon = CHAT_ICONS[name] || MessageSquareText;
  return <Icon size={size} className={className} aria-hidden="true" />;
}
