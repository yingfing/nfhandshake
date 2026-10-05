你需要的仓库地址，我按**开发工具链、模组依赖、源码研究参考**分类整理好了，可以直接复制使用。

### 🛠️ 核心开发工具链

这些是你搭建开发环境、构建模组必须用到的工具仓库。

| 项目 | 用途 | 仓库地址 |
| :--- | :--- | :--- |
| **Fabric Loom** | Gradle插件，用于搭建反混淆的Minecraft开发环境 | `https://github.com/FabricMC/fabric-loom` |
| **Fabric Loader** | Fabric模组加载器，提供模组加载和抽象API | `https://github.com/FabricMC/fabric-loader` |
| **Fabric API** | Fabric生态的核心API，提供事件钩子等 | `https://github.com/FabricMC/fabric-api` |
| **Yarn Mappings** | Fabric社区维护的Minecraft映射，用于将混淆代码转为可读名称 | `https://github.com/FabricMC/yarn` |
| **Mixin** | 字节码注入框架，用于修改Minecraft代码 | `https://github.com/FabricMC/Mixin` |

### 📦 模组依赖与运行环境

这些是你在 `build.gradle` 中需要声明的依赖，以及用于研究服务端协议的NeoForge源码。

| 项目 | 用途 | 仓库地址 |
| :--- | :--- | :--- |
| **ViaFabricPlus** | 版本协议翻译模组，让高版本客户端连接低版本服务器 | `https://github.com/ViaVersion/ViaFabricPlus` |
| **NeoForge** | NeoForge服务器端源码，用于研究网络协议和握手逻辑 | `https://github.com/neoforged/NeoForge` |
| **NeoForm** | NeoForge的反编译工具链，用于生成可读的Minecraft源码 | `https://github.com/neoforged/NeoForm` |

### 📚 源码研究与开发辅助

这些资源可以帮助你理解NeoForge的网络实现细节，或作为模组项目的起始模板。

| 项目 | 用途 | 仓库地址 |
| :--- | :--- | :--- |
| **NeoForge MDKs** | NeoForge官方模组开发套件，包含各版本的起始模板 | `https://github.com/NeoForgeMDKs` |
| **Fabric Example Mod** | Fabric官方示例模组，可作为项目结构参考 | `https://github.com/FabricMC/fabric-example-mod` |

### 💡 关于克隆 NeoForge 源码的提醒

克隆 NeoForge 仓库时，建议只拉取 `1.21.x` 分支，并开启 `--single-branch` 和 `--recurse-submodules`，以节省时间和磁盘空间：

```bash
git clone --branch 1.21.x --single-branch --recurse-submodules https://github.com/neoforged/NeoForge.git
```

如果 `1.21.x` 分支不存在，可以改用 `--branch 1.21.1`，或到 NeoForge 的 Releases 页面查找精确的版本标签。