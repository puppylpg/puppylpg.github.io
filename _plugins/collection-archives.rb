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

      merge_into_site_index(site, docs)
      build_archive(site, docs, 'categories', 'category')
      build_archive(site, docs, 'tags', 'tag')
    end

    private

    # 把自定义 collection 的 docs merge 到 site.categories / site.tags,
    # 否则 chirpy 的 /categories/ /tags/ 索引 Tab 里看不到这些文章。
    def merge_into_site_index(site, docs)
      docs.each do |doc|
        next if doc.respond_to?(:collection) && doc.collection.label == 'posts'
        Array(doc.data['categories']).each do |cat|
          next if cat.nil? || cat.to_s.strip.empty?
          site.categories[cat] ||= []
          site.categories[cat] << doc unless site.categories[cat].include?(doc)
        end
        Array(doc.data['tags']).each do |tag|
          next if tag.nil? || tag.to_s.strip.empty?
          site.tags[tag] ||= []
          site.tags[tag] << doc unless site.tags[tag].include?(doc)
        end
      end

      [site.categories, site.tags].each do |index|
        index.each_value do |arr|
          arr.sort_by! { |d| d.date || Time.at(0) }
          arr.reverse!
        end
      end
    end

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
