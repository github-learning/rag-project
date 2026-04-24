# `volumes/` 目录说明

本目录用于 **Docker Compose（或同类）把容器内数据映射到宿主机**，方便开发时 **重启容器不丢 Milvus 元数据与对象存储**。

| 子目录 | 常见用途 |
|--------|----------|
| **`etcd/`** | etcd 的 WAL、快照等。Milvus 用它存 **集群/集合元数据**（有哪些 collection、字段、索引配置等），不是向量正文文件本身。 |
| **`minio/`** | MinIO 本地数据。Milvus 若配置为 MinIO 后端，**索引与二进制对象**等会落盘在这里。 |

## 使用注意

- 目录体积会随建库、建索引、入库量 **变大**，已默认写入仓库根目录 `.gitignore`（仅保留本 `README.md` 可提交）。
- **删除整个 `volumes/`** 相当于清空本地 Milvus 依赖存储：下次启动容器后通常需 **重新建集合 / 重新上传文档**（视你的 compose 与 Milvus 版本而定）。
- 若曾误把 `volumes/` 下大文件提交进 Git，需从索引移除：`git rm -r --cached volumes/etcd volumes/minio`（路径按实际调整），再提交。

## 与项目代码的关系

应用（Nest 等）只通过 **`MILVUS_ADDRESS`** 等连 Milvus 服务；`volumes/` 是 **依赖组件在磁盘上的状态**，不参与前后端编译。
