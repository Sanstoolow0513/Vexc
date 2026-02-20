/**
 * Vexc - 赛博-东方主义设计演示
 * Cyber-Easternism Design Demo
 *
 * 展示独特的 UI 组件和交互效果
 */

import React from 'react';
import './App.cyber-eastern.css';

// 图标导入
import {
  FileCode,
  Folder,
  Terminal,
  GitBranch,
  Search,
  Settings,
  X,
  Minus,
  Square,
  Plus,
  ChevronRight,
  ChevronDown,
  Activity,
  Cpu,
  Database,
  Globe,
  Lock,
  Zap,
} from 'lucide-react';

interface DemoComponentProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

const DemoSection: React.FC<DemoComponentProps> = ({ title, description, children }) => (
  <div style={{
    marginBottom: '48px',
    padding: '24px',
    border: '1px solid rgba(212, 175, 55, 0.2)',
    borderRadius: '8px',
    background: 'rgba(15, 22, 41, 0.9)',
    backdropFilter: 'blur(20px)',
  }}>
    <h2 style={{
      fontSize: '18px',
      fontWeight: 700,
      color: '#d4af37',
      marginBottom: '8px',
      fontFamily: '"Orbitron", "Rajdhani", sans-serif',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
    }}>
      {title}
    </h2>
    <p style={{
      fontSize: '13px',
      color: '#a0a8b8',
      marginBottom: '24px',
    }}>
      {description}
    </p>
    {children}
  </div>
);

const CyberEasternDemo: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState<'editor' | 'terminal'>('editor');
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      overflow: 'auto',
      position: 'relative',
    }}>
      {/* 窗口标题栏 */}
      <div className="window-bar">
        <div className="window-drag">
          <div className="brand-icon">
            <FileCode size={18} color="white" />
          </div>
          <div className="brand-meta">
            <div className="brand-title">VEXC</div>
            <div className="brand-subtitle">赛博-东方主义代码编辑器</div>
          </div>
        </div>

        <div className="header-menus">
          <div className="header-menu">
            <button className="menu-tab">
              <FileCode size={18} />
            </button>
          </div>
          <div className="header-menu">
            <button className="menu-tab">
              <Terminal size={18} />
            </button>
          </div>
          <div className="header-menu">
            <button className="menu-tab">
              <Search size={18} />
            </button>
          </div>
          <div className="header-menu">
            <button className="menu-tab">
              <GitBranch size={18} />
            </button>
          </div>
        </div>

        <div className="window-controls">
          <button className="window-control">
            <Minus size={14} className="window-control-icon" />
          </button>
          <button className="window-control">
            <Square size={12} className="window-control-icon" />
          </button>
          <button className="window-control close">
            <X size={14} className="window-control-icon" />
          </button>
        </div>
      </div>

      {/* 工作区 */}
      <div className="workbench-grid">
        {/* 活动栏 */}
        <div className="activity-bar">
          <button className="activity-button active">
            <FileCode size={20} />
          </button>
          <button className="activity-button">
            <Search size={20} />
          </button>
          <button className="activity-button">
            <GitBranch size={20} />
          </button>
          <button className="activity-button">
            <Terminal size={20} />
          </button>
          <button className="activity-button">
            <Activity size={20} />
          </button>
          <div style={{ flex: 1 }} />
          <button className="activity-button">
            <Settings size={20} />
          </button>
        </div>

        {/* 资源管理器 */}
        <div className="explorer-panel">
          <div className="explorer-toolbar">
            <button className="explorer-action icon-only">
              <Plus size={16} />
            </button>
            <button className="explorer-action icon-only">
              <Folder size={16} />
            </button>
            <button className="explorer-action icon-only">
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="explorer-root">
            <div
              className="tree-item root"
              onClick={() => setSelectedFile('root')}
            >
              <div className="tree-marker">
                <ChevronDown size={14} />
              </div>
              <div className="tree-label">📁 Vexc Project</div>
            </div>

            <div
              className="tree-item"
              onClick={() => setSelectedFile('src')}
            >
              <div className="tree-marker">
                <ChevronRight size={14} />
              </div>
              <Folder size={16} style={{ color: '#d4af37' }} />
              <div className="tree-label">src</div>
            </div>

            <div
              className="tree-item"
              onClick={() => setSelectedFile('components')}
              style={{ paddingLeft: '28px' }}
            >
              <div className="tree-marker">
                <ChevronRight size={14} />
              </div>
              <Folder size={16} style={{ color: '#7ec8ac' }} />
              <div className="tree-label">components</div>
            </div>

            <div
              className={`tree-item ${selectedFile === 'App.tsx' ? 'active' : ''}`}
              onClick={() => setSelectedFile('App.tsx')}
              style={{ paddingLeft: '28px' }}
            >
              <div className="tree-marker" />
              <FileCode size={16} style={{ color: '#6c5ce7' }} />
              <div className="tree-label">App.tsx</div>
            </div>

            <div
              className={`tree-item ${selectedFile === 'index.css' ? 'active' : ''}`}
              onClick={() => setSelectedFile('index.css')}
              style={{ paddingLeft: '28px' }}
            >
              <div className="tree-marker" />
              <FileCode size={16} style={{ color: '#d4af37' }} />
              <div className="tree-label">index.css</div>
            </div>

            <div
              className="tree-item"
              onClick={() => setSelectedFile('package.json')}
            >
              <div className="tree-marker" />
              <Database size={16} style={{ color: '#e63946' }} />
              <div className="tree-label">package.json</div>
            </div>

            <div
              className="tree-item"
              onClick={() => setSelectedFile('readme')}
            >
              <div className="tree-marker" />
              <FileCode size={16} style={{ color: '#7ec8ac' }} />
              <div className="tree-label">README.md</div>
            </div>
          </div>
        </div>

        <div className="explorer-resizer" />

        {/* 编辑器区域 */}
        <div className="editor-panel">
          <div className="tab-strip">
            <div className="tab-strip-scroll">
              <div className={`tab-item ${activeTab === 'editor' ? 'active' : ''}`}>
                <button className="tab-button" onClick={() => setActiveTab('editor')}>
                  <FileCode size={14} />
                  <span className="tab-title-text">App.tsx</span>
                </button>
                <button className="tab-close">
                  <X size={14} className="tab-close-icon" />
                </button>
              </div>

              <div className={`tab-item ${activeTab === 'terminal' ? 'active' : ''}`}>
                <button className="tab-button" onClick={() => setActiveTab('terminal')}>
                  <Terminal size={14} />
                  <span className="tab-title-text">Terminal</span>
                </button>
                <button className="tab-close">
                  <X size={14} className="tab-close-icon" />
                </button>
              </div>
            </div>

            <div className="tab-strip-actions">
              <button className="tab-add">
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="editor-surface">
            {activeTab === 'editor' ? (
              <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                color: '#6b7280',
              }}>
                <FileCode size={64} style={{ marginBottom: '16px', opacity: 0.5 }} />
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: '#e8eaf0',
                  marginBottom: '8px',
                }}>
                  赛博-东方主义编辑器
                </h3>
                <p className="empty-text">
                  融合东方传统美学与赛博朋克元素的独特代码编辑体验
                </p>
              </div>
            ) : (
              <div className="terminal-surface active">
                <div className="terminal-host">
                  <div style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: '13px',
                    color: '#7ec8ac',
                    padding: '8px',
                  }}>
                    <div>$ npm run dev</div>
                    <div style={{ color: '#d4af37', marginTop: '8px' }}>
                      Starting development server...
                    </div>
                    <div style={{ color: '#6c5ce7', marginTop: '8px' }}>
                      ✓ Compiled successfully in 1234ms
                    </div>
                    <div style={{ color: '#e63946', marginTop: '8px' }}>
                      > Local: http://localhost:1420/
                    </div>
                    <div style={{ marginTop: '16px', color: '#6b7280' }}>
                      Press Ctrl+C to stop
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 设计说明浮层 */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        width: '320px',
        padding: '20px',
        border: '1px solid rgba(212, 175, 55, 0.3)',
        borderRadius: '8px',
        background: 'rgba(10, 14, 26, 0.95)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6), 0 0 20px rgba(230, 57, 70, 0.3)',
        zIndex: 1000,
      }}>
        <h3 style={{
          fontSize: '16px',
          fontWeight: 700,
          color: '#d4af37',
          marginBottom: '12px',
          fontFamily: '"Orbitron", "Rajdhani", sans-serif',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}>
          赛博-东方主义
        </h3>
        <div style={{ fontSize: '12px', color: '#a0a8b8', lineHeight: 1.6 }}>
          <p style={{ marginBottom: '8px' }}>
            <strong style={{ color: '#e63946' }}>色彩系统：</strong>
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: '#0a0e1a',
              border: '1px solid rgba(212, 175, 55, 0.3)',
            }} />
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: '#e63946',
              boxShadow: '0 0 10px rgba(230, 57, 70, 0.5)',
            }} />
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: '#d4af37',
              boxShadow: '0 0 10px rgba(212, 175, 55, 0.5)',
            }} />
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: '#7ec8ac',
              boxShadow: '0 0 10px rgba(126, 200, 172, 0.5)',
            }} />
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              background: '#6c5ce7',
              boxShadow: '0 0 10px rgba(108, 92, 231, 0.5)',
            }} />
          </div>

          <p style={{ marginBottom: '8px' }}>
            <strong style={{ color: '#d4af37' }}>设计元素：</strong>
          </p>
          <ul style={{
            margin: 0,
            paddingLeft: '16px',
            marginBottom: '12px',
          }}>
            <li>云纹纹理 + 像素网格</li>
            <li>朱砂红霓虹光晕</li>
            <li>金箔装饰线条</li>
            <li>扫描线 + 噪点效果</li>
            <li>流畅的东方缓动曲线</li>
          </ul>

          <p style={{ marginBottom: '8px' }}>
            <strong style={{ color: '#7ec8ac' }}>交互特性：</strong>
          </p>
          <ul style={{
            margin: 0,
            paddingLeft: '16px',
          }}>
            <li>悬停时的位移反馈</li>
            <li>动态光晕效果</li>
            <li>环境光呼吸动画</li>
            <li>墨水晕散过渡</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default CyberEasternDemo;
