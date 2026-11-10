# 雪蘅的文集

> 文学评论、社会评论，以及还没有名字的那一类。

文章按主题分册存放在几个仓库里。这里不是博客，是书架：每个分册自己装文章，书架只负责把它们摆在一起。

讨论、勘误、选题，都在 [Discussions](https://github.com/frostseclusion/essays/discussions)。

<!-- BEGIN:SHELF -->
_还没有文章。_
<!-- END:SHELF -->

## 这是怎么运作的

- 文章不存这个仓库。每个分册是一个独立仓库，自己装自己的文章、图片和许可。
- 这个仓库只做三件事：拉取各分册的 `posts/`、过滤出 `status: published`、生成上面那块目录和 `feed.xml`。
- 生成物由 GitHub Actions 定时重建，手工改目录会被下一次构建覆盖。
- **许可**：这里的文字按 [CC BY-NC-SA 4.0](LICENSE) 授权；脚本用 [MIT](scripts/LICENSE)。

## 分册

| 分册 | 仓库 |
| --- | --- |
| 文学评论 | [literary-criticism](https://github.com/frostseclusion/literary-criticism) |
| 社会评论 | [social-commentary](https://github.com/frostseclusion/social-commentary) |

## 订阅

- 全部文章：`feed.xml`
- 只要某一册：`feeds/literary-criticism.xml`、`feeds/social-commentary.xml`

## 加新分册

1. 按 `literary-criticism` 的结构建一个新仓库；
2. 在 `sources.json` 的 `sources` 里加一项；
3. 跑一次 `node scripts/build-shelf.mjs`。

不需要改脚本。
