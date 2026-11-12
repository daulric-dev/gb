-- Library tags are searchable and have validation rules, so store them as
-- normalized rows instead of a PostgreSQL text array.
CREATE TABLE course.library_item_tag (
    item_id uuid NOT NULL,
    tag text NOT NULL,
    CONSTRAINT library_item_tag_pkey PRIMARY KEY (item_id, tag),
    CONSTRAINT library_item_tag_item_fkey FOREIGN KEY (item_id)
        REFERENCES course.library_item(id) ON DELETE CASCADE
);

CREATE INDEX library_item_tag_tag_item_idx ON course.library_item_tag (tag, item_id);

INSERT INTO course.library_item_tag (item_id, tag)
SELECT DISTINCT item.id, selected.tag
FROM course.library_item AS item
CROSS JOIN LATERAL unnest(item.tags) AS selected(tag);

ALTER TABLE course.library_item DROP COLUMN tags;
