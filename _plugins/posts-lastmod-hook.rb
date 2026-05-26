#!/usr/bin/env ruby
#
# Check for changed posts and collection documents

CONTENT_PREFIXES = %w[
  _posts/
  _AI/
  _open/
  _books/
  _life/
  _tutorials/
].freeze

Jekyll::Hooks.register :documents, :post_init do |doc|
  next unless CONTENT_PREFIXES.any? { |prefix| doc.path.start_with?(prefix) }

  commit_num = `git rev-list --count HEAD "#{doc.path}"`

  if commit_num.to_i > 1
    lastmod_date = `git log -1 --pretty="%ad" --date=iso "#{doc.path}"`
    doc.data['last_modified_at'] = lastmod_date
  end
end
