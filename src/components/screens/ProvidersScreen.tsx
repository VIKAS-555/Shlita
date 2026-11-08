import React, { useState } from 'react';
import {
  Boxes,
  Plus,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { Provider } from '../../types/dashboard.js';

interface ProvidersScreenProps {
  providers: Provider[];
  onAddProvider: (provider: Provider) => void;
}

export const ProvidersScreen: React.FC<ProvidersScreenProps> = ({
  providers,
  onAddProvider,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const [newName, setNewName] = useState('');
  const [newEndpoint, setNewEndpoint] = useState('');
  const [newCategory, setNewCategory] = useState<any>('RPC & Node');

  const categories = ['All', 'RPC & Node', 'AI Search', 'Financial Rails', 'Dev Tools'];

  const filteredProviders = providers.filter((p) => {
    const matchesCat = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCat && matchesSearch;
  });

  const handleCreate = () => {
    const newProv: Provider = {
      id: `prov-${Date.now()}`,
      name: newName || 'Custom API Service',
      category: newCategory,
      logo: '⚡',
      endpoint: newEndpoint || 'https://api.custom-service.io',
      supportedTokens: ['USDC'],
      status: 'VERIFIED',
      connectedAgentsCount: 1,
      totalSpentUsdc: 0.0,
      tags: ['API', 'CUSTOM'],
    };
    onAddProvider(newProv);
    setShowAddModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h2 className="text-xl font-bold text-text-primary tracking-tight">Approved Providers & Vendors</h2>
          <p className="text-xs text-text-muted mt-1">
            Authorize and manage verified external API endpoints, RPC nodes, and SaaS merchants.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 bg-gradient-to-r from-accent-violet to-solana-purple hover:opacity-95 text-white font-semibold text-xs px-4 py-2.5 rounded-xl shadow-sm transition cursor-pointer"
        >
          <Plus size={16} />
          <span>Connect Provider</span>
        </button>
      </div>

      {/* Category Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1.5 bg-card border border-border p-1 rounded-xl text-xs font-mono overflow-x-auto">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                selectedCategory === cat
                  ? 'bg-accent-violet text-white font-semibold shadow-sm'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <div className="relative max-w-xs w-full">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-card border border-border focus:border-accent-violet rounded-xl pl-9 pr-4 py-1.5 text-xs text-text-primary placeholder-text-muted outline-none transition shadow-sm"
          />
        </div>
      </div>

      {/* Responsive 3-Column Provider Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredProviders.map((provider) => (
          <div
            key={provider.id}
            className="bg-card border border-border rounded-2xl p-5 shadow-sm space-y-4 hover:border-border-hover transition flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-xl bg-card-elevated border border-border flex items-center justify-center text-lg shadow-sm">
                    {provider.logo}
                  </div>
                  <div>
                    <h3 className="font-bold text-text-primary text-sm">{provider.name}</h3>
                    <span className="text-[10px] text-text-muted font-mono block">{provider.category}</span>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded-full text-[10px] font-mono">
                  <CheckCircle2 size={10} /> {provider.status}
                </span>
              </div>

              {/* Endpoint Link */}
              <div className="bg-card-elevated p-2.5 rounded-xl border border-border text-[11px] font-mono text-text-secondary truncate">
                {provider.endpoint}
              </div>

              {/* Tags / Capability Pills */}
              <div className="flex flex-wrap gap-1.5">
                {provider.tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-card-elevated text-text-muted border border-border text-[9px] font-mono px-2 py-0.5 rounded-md uppercase"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Provider Metrics Footer */}
            <div className="pt-3 border-t border-border/80 flex items-center justify-between text-xs font-mono text-text-muted">
              <span>{provider.connectedAgentsCount} agents connected</span>
              <span className="font-bold text-text-primary">${provider.totalSpentUsdc.toFixed(2)} spent</span>
            </div>
          </div>
        ))}
      </div>

      {/* Connect Provider Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border w-full max-w-md rounded-2xl p-6 space-y-4 shadow-xl animate-in fade-in zoom-in-95">
            <h3 className="font-bold text-text-primary text-base">Connect New Provider</h3>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1">Provider Name</label>
              <input
                type="text"
                placeholder="e.g. QuickNode IPFS Gateway"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-xs text-text-primary outline-none font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1">API Endpoint / Payment Address</label>
              <input
                type="text"
                placeholder="https://api.example.com"
                value={newEndpoint}
                onChange={(e) => setNewEndpoint(e.target.value)}
                className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-xs text-text-primary outline-none font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-text-secondary block mb-1">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full bg-card-elevated border border-border rounded-xl px-3 py-2 text-xs text-text-primary outline-none font-mono"
              >
                <option value="RPC & Node">RPC & Node</option>
                <option value="AI Search">AI Search</option>
                <option value="Financial Rails">Financial Rails</option>
                <option value="Dev Tools">Dev Tools</option>
              </select>
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-border">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-xs text-text-muted hover:text-text-primary transition"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="bg-accent-violet hover:bg-accent-violet/90 text-white font-semibold text-xs px-4 py-2 rounded-xl transition shadow-sm"
              >
                Authorize Provider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
