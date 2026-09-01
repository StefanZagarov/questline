from django import template

register = template.Library()


@register.filter
def placeholder(value, token):
    value.field.widget.attrs["placeholder"] = token
    return value


# Tag for getting values from dicts
@register.filter
def get_item(mapping, key):
    return mapping.get(key)
