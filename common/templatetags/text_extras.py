from django import template

register = template.Library()


@register.filter
def transform_underscore(value):
    return value.replace("_", " ")
