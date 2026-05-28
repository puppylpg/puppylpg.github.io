# frozen_string_literal: true

# 替代 jekyll-archives：让所有 collection（不只 _posts）的 categories/tags
# 都参与归档页生成。chirpy 主题里 post.html 渲染的 /categories/<slug>/、
# /tags/<slug>/ 链接，对应的归档页就是这里产生的。
#
# 设计说明：
# - slug 用 Jekyll::Utils.slugify，与 Liquid 的 `slugify` filter 一致，
#   保证文章里渲染的链接和这里生成的页面 URL 对得上。
# - 同一 slug 可能对应多个原始名（"claude code" 和 "claude-code"），
#   取首个非空名作为页面标题。
# - posts 按 date 倒序；缺失 date 的排到末尾。

module Jekyll
  class CollectionArchivePage < Page
    def initialize(site, dir, layout, title, posts)
      @site = site
      @base = site.source
      @dir = dir
      @name = 'index.html'
      process(@name)
      self.data = {
        'layout' => layout,
        'title'  => title,
        'posts'  => posts
      }
    end
  end

  class CollectionArchiveGenerator < Generator
    safe true
    priority :low

    def generate(site)
      docs = site.posts.docs.dup
      site.collections.each do |label, collection|
        next if label == 'posts'
        docs.concat(collection.docs)
      end

      build_archive(site, docs, 'categories', 'category')
      build_archive(site, docs, 'tags', 'tag')
    end

    private

    def build_archive(site, docs, field, layout)
      groups = {}
      docs.each do |doc|
        names = Array(doc.data[field])
        names.each do |name|
          next if name.nil? || name.to_s.strip.empty?
          slug = Jekyll::Utils.slugify(name.to_s)
          next if slug.empty?
          entry = (groups[slug] ||= { title: name.to_s, docs: [] })
          entry[:docs] << doc
        end
      end

      groups.each do |slug, entry|
        entry[:docs].sort_by! { |d| d.date || Time.at(0) }
        entry[:docs].reverse!
        site.pages << CollectionArchivePage.new(
          site, "#{field}/#{slug}", layout, entry[:title], entry[:docs]
        )
      end
    end
  end
end
